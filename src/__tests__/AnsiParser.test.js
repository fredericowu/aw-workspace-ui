import { describe, it, expect } from 'vitest';
describe('AnsiParser', () => {
  it('should be importable', async () => {
    const mod = await import('../components/AnsiParser');
    expect(mod).toBeDefined();
  });
});
