// @ts-check
/** @param {HTMLSelectElement} select @param {import('../types.js').NoteSummary[]} notes @param {string | null} focus */
export function populateFocus(select, notes, focus) {
  select.replaceChildren();
  const all = document.createElement('option'); all.value = ''; all.textContent = 'All notes'; select.append(all);
  for (const note of notes.slice().sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
    const option = document.createElement('option'); option.value = note.id; option.textContent = note.title || 'Untitled (' + note.id + ')'; select.append(option);
  }
  select.value = focus || '';
}
