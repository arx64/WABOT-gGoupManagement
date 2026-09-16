import { addReminder } from './addReminder.js';

/**
 * Parse a multi-block schedule text and add each entry to the reminders DB.
 * Expected block format (blocks separated by one or more blank lines):
 * Course Name
 * Day, HH.mm - HH.mm
 * Link ... <url>
 * optional additional links/lines
 *
 * Returns an array with result objects for each parsed block.
 */
export async function parseAndAdd(text, addedBy) {
  if (!text || !text.trim()) return [];

  // Normalize line endings and split blocks by empty lines
  const normalized = text.replace(/\r/g, '');
  const blocks = normalized.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const timeRegex = /([0-2]?\d[.:][0-5]\d)\s*-\s*([0-2]?\d[.:][0-5]\d)/;

  const results = [];

  for (const block of blocks) {
    try {
      const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        results.push({ block, success: false, reason: 'Not enough lines (expect at least course name and time line)' });
        continue;
      }

      const courseName = lines[0];

      // Find time line (usually second line)
      const timeLine = lines[1];

      // Extract day (text before comma) or the first word
      let day = '';
      const commaIdx = timeLine.indexOf(',');
      if (commaIdx !== -1) {
        day = timeLine.slice(0, commaIdx).trim();
      } else {
        // fallback: first token (e.g., 'Senin')
        day = (timeLine.split(/\s+/)[0] || '').trim();
      }

      // Extract start time using regex; convert dots to colons
      let startTime = '';
      const timeMatch = timeLine.match(timeRegex);
      if (timeMatch) {
        startTime = timeMatch[1].replace('.', ':');
      } else {
        // try to find a single time like 08.30 or 08:30
        const single = timeLine.match(/([0-2]?\d[.:][0-5]\d)/);
        if (single) startTime = single[1].replace('.', ':');
      }

      // Find first URL in block (google form or zoom link)
      const urls = [];
      for (const l of lines) {
        const m = l.match(urlRegex);
        if (m) urls.push(...m);
      }
      const zoomLink = urls.length ? urls[0] : '';

      // Normalize day string for DB (addReminder expects day names like 'Senin' or list)
      const days = day || '';

      // Use addReminder to insert into DB
      await addReminder(courseName, zoomLink, startTime || '', days, addedBy);

      results.push({ courseName, zoomLink, reminderTime: startTime, days, success: true });
    } catch (err) {
      results.push({ block, success: false, reason: err.message });
    }
  }

  return results;
}

export default parseAndAdd;
