// The native registry retains its catalog, scope cache, watchers and skill loader.
// This provider narrows filesystem candidates to the calling Tavern Agent's role.
export function createTavernSkillProvider({ providers, library, roleFor, enabledFor = async () => true }) {
  const name = 'tavern'
  async function allowed(candidate, lookup) {
    const role = await roleFor(lookup.scope)
    if (!role) return false
    const skill = await library.read(candidate.name)
    return skill?.path === candidate.path && skill.agents.includes(role) && await enabledFor(skill, lookup.scope)
  }
  return {
    name,
    async list(lookup) {
      const candidates = []
      let complete = true
      for (let index = 0; index < providers.length; index++) {
        const result = await providers[index].list(lookup)
        complete = complete && (Array.isArray(result) || result.complete)
        for (const candidate of Array.isArray(result) ? result : result.candidates) {
          if (await allowed(candidate, lookup)) candidates.push({ ...candidate, provider: name, locator: { index, candidate } })
        }
      }
      return { candidates, complete }
    },
    async get(candidate, lookup) {
      const original = candidate.locator.candidate
      if (!await allowed(original, lookup)) return undefined
      const skill = await providers[candidate.locator.index].get(original, lookup)
      return skill ? { ...skill, provider: name } : undefined
    }
  }
}
