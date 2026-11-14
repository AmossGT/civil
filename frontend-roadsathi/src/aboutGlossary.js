const glossary = [
  {
    term: 'Tender',
    aliases: ['tender'],
    definition: 'A tender is an official invitation by the government asking contractors or companies to offer their prices for completing a particular work or project.',
  },
  {
    term: 'Tender ID',
    aliases: ['tender id', 'tender identification number'],
    definition: 'A Tender ID is a unique identification number assigned to a tender on the government e-procurement portal. It helps users find and track a specific tender.',
  },
  {
    term: 'Reference Number',
    aliases: ['reference number', 'department reference number'],
    definition: 'A Reference Number is an identification number given to a tender or project by the concerned department. It helps identify and refer to the particular work.',
  },
  {
    term: 'AOC',
    aliases: ['aoc', 'award of contract'],
    definition: 'AOC stands for Award of Contract. It indicates that the department has selected a contractor and accepted their offer for carrying out the work.',
  },
  {
    term: 'BOQ',
    aliases: ['boq', 'bill of quantities'],
    definition: 'BOQ stands for Bill of Quantities. It is a document listing the different items of work, their quantities and related costs required to complete a project.',
  },
  {
    term: 'Estimated Tender Value',
    aliases: ['estimated tender value', 'estimated value'],
    definition: 'It is the approximate cost of a project estimated by the government before inviting contractors to submit their offers.',
  },
  {
    term: 'Contract',
    aliases: ['contract'],
    definition: 'A contract is a formal agreement between the government and the selected contractor. It specifies the work to be completed, the agreed cost and the conditions to be followed.',
  },
  {
    term: 'Contract Amount',
    aliases: ['contract amount', 'awarded contract amount'],
    definition: 'The Contract Amount is the agreed price at which the selected contractor will complete the project. It represents the value of the contract, not necessarily the money already paid.',
  },
  {
    term: 'Work Order',
    aliases: ['work order', 'workorder'],
    definition: 'A Work Order is an official document issued by the department instructing the selected contractor to carry out the specified work under the agreed conditions.',
  },
]

function normalizeQuestion(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

export function findAboutDefinition(question) {
  const normalized = normalizeQuestion(question)
  if (!normalized) return null

  const termAliases = glossary.flatMap(entry => entry.aliases.map(alias => ({ entry, alias: normalizeQuestion(alias) })))
    .sort((left, right) => right.alias.length - left.alias.length)
  const matched = termAliases.find(({ alias }) => new RegExp(`(?:^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\b)`).test(normalized))
  if (!matched) return null

  const exactTerm = termAliases.some(({ alias }) => alias === normalized)
  const definitionQuestion = /^(what is|what does|explain|define|meaning of|what is the meaning of|tell me about|can you explain|what about)\b/.test(normalized)
  return exactTerm || definitionQuestion ? matched.entry : null
}
