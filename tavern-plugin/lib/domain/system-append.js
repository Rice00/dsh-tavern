// Append at assembly time so saved edits also apply to existing sessions.
export function appendSystemInstruction(assembly, text) {
  const sections = (assembly.sections || []).filter(section => section.name !== 'tavern:system-append')
  if (typeof text === 'string' && text.trim()) sections.push({ name: 'tavern:system-append', text: text.trim() })
  assembly.sections = sections
  return assembly
}
