// @ts-check
/** @type {Record<import('../types.js').LinkType, {label: string, description: string}>} */
export const relations = {
  'part-of': { label: 'Part of', description: 'Part of → context' },
  related: { label: 'Related to', description: 'Related to' },
  'depends-on': { label: 'Depends on', description: 'Depends on → prerequisite' }
};
