import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import McpGatewayNamedConfigs from '../components/McpGatewayNamedConfigs';

const PAYLOAD = {
  configs: {
    crispal: { upstreams: ['aw-crispal'] },
    'crispal-full': {
      upstreams: ['aw-crispal', 'agents-platform-runners'],
      run_agents_approval: ['*'],
      run_agents_always_allow: ['crispal*'],
    },
  },
  candidates: [
    { name: 'agents-platform-runners', type: 'stdio', running: true, tools: 40 },
    { name: 'aw-crispal', type: 'stdio', running: true, tools: 12 },
    { name: 'kb', type: 'http', running: false, tools: 0 },
  ],
  policy_upstreams: {
    agents_platform: ['agents-platform-runners', 'agents-platform'],
    knowledge_base: ['kb', 'aw-knowledge-base'],
    presentation: ['aw-presentation'],
  },
  endpoint_template: 'http://127.0.0.1:9200/mcp/{name}',
};

function mockLoad(payload = PAYLOAD) {
  apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
}

async function renderLoaded() {
  render(<McpGatewayNamedConfigs />);
  await waitFor(() => expect(screen.getByTestId('mcpgw-config-add')).toBeInTheDocument());
}

describe('McpGatewayNamedConfigs', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad(); });

  it('lists each config with its scoped endpoint URL', async () => {
    await renderLoaded();
    expect(screen.getByText('Scoped endpoints (2)')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:9200/mcp/crispal')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:9200/mcp/crispal-full')).toBeInTheDocument();
  });

  it('reveals the agents-platform run policy only for a config that enables it', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByText('crispal'));
    expect(screen.queryByText('Agents Platform run policy')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('crispal'));           // collapse
    fireEvent.click(screen.getByText('crispal-full'));
    expect(screen.getByText('Agents Platform run policy')).toBeInTheDocument();
    // ...pre-filled from the saved spec.
    const approval = screen.getByText('Agents needing approval').closest('label');
    expect(within(approval).getByRole('textbox')).toHaveValue('*');
    const exempt = screen.getByText('Agents always allowed').closest('label');
    expect(within(exempt).getByRole('textbox')).toHaveValue('crispal*');
  });

  it('enabling an upstream reveals its nested policy immediately', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('crispal'));

    fireEvent.click(screen.getByRole('switch', { name: 'Add agents-platform-runners' }));

    expect(screen.getByText('Agents Platform run policy')).toBeInTheDocument();
  });

  it('saves the edited set and reports that no restart is needed', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('crispal'));
    fireEvent.click(screen.getByRole('switch', { name: 'Add kb' }));

    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...PAYLOAD,
        configs: { ...PAYLOAD.configs, crispal: { upstreams: ['aw-crispal', 'kb'] } },
      }),
    });
    fireEvent.click(screen.getByTestId('mcpgw-configs-save'));

    await waitFor(() => expect(screen.getByTestId('mcpgw-configs-msg')).toHaveTextContent(/no restart/i));
    const put = apiFetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
    expect(JSON.parse(put[1].body).configs.crispal.upstreams).toEqual(['aw-crispal', 'kb']);
  });

  it('deleting takes two clicks — native confirm() is dead inside a settings iframe', async () => {
    await renderLoaded();
    const row = screen.getByText('crispal').closest('.mcpgw-cfg');

    fireEvent.click(within(row).getByText('Delete'));
    expect(screen.getByText('crispal')).toBeInTheDocument();   // still there

    fireEvent.click(within(row).getByText('Confirm'));
    expect(screen.queryByText('crispal')).not.toBeInTheDocument();
    expect(screen.getByText('Scoped endpoints (1)')).toBeInTheDocument();
  });

  it('keeps showing an upstream a config names but the gateway no longer has', async () => {
    mockLoad({
      ...PAYLOAD,
      configs: { legacy: { upstreams: ['aw-resize-image'] } },
    });
    await renderLoaded();
    fireEvent.click(screen.getByText('legacy'));

    expect(screen.getByText('not on this gateway')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Remove aw-resize-image' })).toBeInTheDocument();
  });

  it('surfaces a rejected save instead of pretending it worked', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('crispal'));
    fireEvent.click(screen.getByRole('switch', { name: 'Add kb' }));

    apiFetch.mockResolvedValue({
      ok: false, status: 400,
      json: () => Promise.resolve({ error: "invalid config name 'x/y'" }),
    });
    fireEvent.click(screen.getByTestId('mcpgw-configs-save'));

    await waitFor(() => expect(screen.getByTestId('mcpgw-configs-msg')).toHaveTextContent(/invalid config name/));
  });
});

describe('McpGatewayNamedConfigs — profile-wide tool ACL', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad(); });

  it('shows the tool ACL above the upstream rows, not nested under one', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('crispal'));

    // Present with no upstream toggled on — it is profile-wide.
    const field = screen.getByText('Tool name patterns').closest('label');
    expect(within(field).getByRole('textbox')).toHaveValue('');
  });

  it('saves tool globs as a list', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('crispal'));
    const field = screen.getByText('Tool name patterns').closest('label');
    fireEvent.blur(within(field).getByRole('textbox'), {
      target: { value: 'get_site_info, crispal_image_*' },
    });

    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(PAYLOAD) });
    fireEvent.click(screen.getByTestId('mcpgw-configs-save'));

    await waitFor(() => expect(screen.getByTestId('mcpgw-configs-msg')).toBeInTheDocument());
    const put = apiFetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(JSON.parse(put[1].body).configs.crispal.tools_allow)
      .toEqual(['get_site_info', 'crispal_image_*']);
  });
});
