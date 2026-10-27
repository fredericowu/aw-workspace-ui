export const ANTIGRAVITY_AGENT = {
  type: 'antigravity',
  label: 'Antigravity',
  command: 'agy',
  color: '#4285f4',
  icon: 'antigravity',
};

export function withAntigravityAgent(agents = []) {
  if (agents.some((agent) => agent.type === ANTIGRAVITY_AGENT.type)) return agents;
  return [...agents, ANTIGRAVITY_AGENT];
}

export function buildAntigravityCommand(resumeSessionId = null, isInsecure = false) {
  let command = 'agy';
  if (resumeSessionId) command += ` --conversation ${resumeSessionId}`;
  if (isInsecure) command += ' --dangerously-skip-permissions';
  return command;
}
