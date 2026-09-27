const exportButton = document.querySelector('#export-button');
const activityFilter = document.querySelector('#activity-filter');

exportButton?.addEventListener('click', () => {
  const record = localStorage.getItem('lekharxApprovedRecord') || '{}';
  const blob = new Blob([record], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'lekharx-audit-log.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

activityFilter?.addEventListener('change', (event) => {
  const selected = event.target.value;
  document.querySelectorAll('.audit-table .table-row:not(.table-head)').forEach((row) => {
    const status = row.querySelector('.table-status')?.textContent.trim();
    row.hidden = selected !== 'All activity' && status !== selected;
  });
});
