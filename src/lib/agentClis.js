// Bridge to the decoupled `aw-app-code-agent-clis` (`window.__awCodeAgentClis`)
// and `aw-app-terminal` (`window.__awTerminal`) plugins, with fallback defaults
// before the plugin bundle finishes dynamic-importing on initial page load.

export const ANTIGRAVITY_AGENT = {
  type: 'antigravity',
  label: 'Antigravity',
  command: 'agy',
  color: '#4285f4',
  icon: 'antigravity',
};

function getPlugin() {
  if (typeof window !== 'undefined' && window.__awCodeAgentClis) {
    return window.__awCodeAgentClis;
  }
  return null;
}

export function withAntigravityAgent(agents = []) {
  const plugin = getPlugin();
  if (plugin && typeof plugin.withManagedAgentClis === 'function') {
    return plugin.withManagedAgentClis(agents);
  }
  if (agents.some((agent) => agent.type === ANTIGRAVITY_AGENT.type)) return agents;
  return [...agents, ANTIGRAVITY_AGENT];
}

export function buildAntigravityCommand(resumeSessionId = null, isInsecure = false) {
  let command = 'agy';
  if (resumeSessionId) command += ` --conversation ${resumeSessionId}`;
  if (isInsecure) command += ' --dangerously-skip-permissions';
  return command;
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function buildAgentCommand(
  agentType,
  resumeSessionId = null,
  isInsecure = false,
  sessionName = null,
  preGeneratedId = null,
  fallbackCommand = null,
) {
  const plugin = getPlugin();
  if (plugin && typeof plugin.buildAgentCommand === 'function') {
    return plugin.buildAgentCommand(
      agentType,
      resumeSessionId,
      isInsecure,
      sessionName,
      preGeneratedId,
      fallbackCommand,
    );
  }
  if (agentType === 'claude') {
    let cmd = fallbackCommand || 'claude';
    if (resumeSessionId) {
      cmd += ` --resume ${resumeSessionId}`;
    } else {
      const newId = preGeneratedId || makeUuid();
      cmd += ` --session-id ${newId}`;
    }
    if (isInsecure) cmd += ' --dangerously-skip-permissions';
    return cmd;
  }
  if (agentType === 'copilot') {
    let cmd = fallbackCommand || 'copilot';
    if (resumeSessionId) cmd += ` --resume ${resumeSessionId}`;
    if (isInsecure) cmd += ' --allow-all';
    return cmd;
  }
  if (agentType === 'cursor') {
    let cmd = fallbackCommand || 'cursor-agent';
    if (resumeSessionId) cmd += ` --resume ${resumeSessionId}`;
    if (isInsecure) cmd += ' --approve-mcps --yolo';
    return cmd;
  }
  if (agentType === 'codex') {
    let cmd = fallbackCommand || 'codex';
    if (resumeSessionId) cmd += ` resume ${resumeSessionId}`;
    if (isInsecure) cmd += ' --dangerously-bypass-approvals-and-sandbox';
    return cmd;
  }
  if (agentType === 'gemini') {
    let cmd = fallbackCommand || 'gemini';
    if (resumeSessionId) {
      cmd += ` --resume ${resumeSessionId}`;
    } else {
      const newId = preGeneratedId || makeUuid();
      cmd += ` --session-id ${newId}`;
    }
    if (isInsecure) cmd += ' --yolo';
    return cmd;
  }
  if (agentType === 'antigravity') {
    return buildAntigravityCommand(resumeSessionId, isInsecure);
  }
  return fallbackCommand || agentType;
}

const DEFAULT_INSECURE_TYPES = new Set([
  'claude',
  'copilot',
  'cursor',
  'codex',
  'gemini',
  'antigravity',
]);

export function supportsInsecureMode(agentType) {
  const plugin = getPlugin();
  if (plugin && typeof plugin.supportsInsecureMode === 'function') {
    return plugin.supportsInsecureMode(agentType);
  }
  return DEFAULT_INSECURE_TYPES.has(agentType);
}

export function getInsecureTooltip(agentType, insecure = false) {
  const plugin = getPlugin();
  if (plugin && typeof plugin.getInsecureTooltip === 'function') {
    return plugin.getInsecureTooltip(agentType, insecure);
  }
  if (insecure) return 'Insecure mode ON — click to disable';
  if (agentType === 'codex') {
    return 'Click to enable insecure mode (--dangerously-bypass-approvals-and-sandbox)';
  }
  if (agentType === 'gemini') {
    return 'Click to enable insecure mode (--yolo — auto-approve all tools)';
  }
  if (agentType === 'cursor') {
    return 'Click to enable insecure mode (--approve-mcps --yolo)';
  }
  if (agentType === 'copilot') {
    return 'Click to enable insecure mode (--allow-all)';
  }
  if (agentType === 'antigravity') {
    return 'Click to enable insecure mode (--dangerously-skip-permissions)';
  }
  return 'Click to enable insecure mode (skip all permission checks)';
}
