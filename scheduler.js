import db from './db.js';

// Scheduler module: send reminder notifications at offsets before scheduled time.
// It records sent notifications in table `reminder_notifications` to avoid duplicates.

let intervalId = null;

async function ensureTable() {
  const exists = await db.schema.hasTable('reminder_notifications');
  if (!exists) {
    await db.schema.createTable('reminder_notifications', (table) => {
      table.increments('id');
      table.integer('reminder_id');
      table.string('notify_date'); // YYYY-MM-DD
      table.integer('offset_min'); // minutes before
      table.timestamp('sent_at').defaultTo(db.fn.now());
    });
  }
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dayAbbrevFromDate(d) {
  // returns Mon, Tue, Wed ...
  const map = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return map[d.getDay()];
}

async function startScheduler(sock, opts = {}) {
  const offsets = opts.offsets ?? [10, 5, 2, 0]; // minutes before
  const freq = opts.freqSeconds ?? 30; // how often to check

  await ensureTable();

  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(async () => {
    try {
      const now = new Date();
      const nowDate = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
      const nowH = pad(now.getHours());
      const nowM = pad(now.getMinutes());
      const nowHHMM = `${nowH}:${nowM}`;
      const todayAbbrev = dayAbbrevFromDate(now); // Mon, Tue

      // fetch all reminders
      const reminders = await db('reminders').select('*');

      for (const r of reminders) {
        if (!r.reminder_time || !r.days) continue;

        // r.days stored as 'Mon, Tue' etc.
        const days = r.days.split(',').map(s => s.trim());
        if (!days.includes(todayAbbrev)) continue;

        // parse scheduled time HH:mm
        const [hh, mm] = r.reminder_time.split(/[:.]/).map(x => parseInt(x,10));
        if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

        const scheduled = new Date(now);
        scheduled.setHours(hh, mm, 0, 0);

        for (const off of offsets) {
          const notifyTime = new Date(scheduled.getTime() - off * 60 * 1000);
          const notifyHH = pad(notifyTime.getHours());
          const notifyMM = pad(notifyTime.getMinutes());
          const notifyHHMM = `${notifyHH}:${notifyMM}`;

          if (notifyHHMM !== nowHHMM) continue;

          // check if already sent
          const already = await db('reminder_notifications')
            .where({ reminder_id: r.id, notify_date: nowDate, offset_min: off })
            .first();
          if (already) continue;

          // send message to r.added_by (assumed stored as JID)
          try {
            const text = `🔔 Pengingat: Mata Kuliah *${r.course_name}* akan dimulai pada ${r.reminder_time} (${off} menit lagi)\nLink: ${r.zoom_link}`;
            await sock.sendMessage(r.added_by, { text });

            // record sent
            await db('reminder_notifications').insert({ reminder_id: r.id, notify_date: nowDate, offset_min: off });
            console.log(`Sent reminder for id=${r.id} offset=${off} to ${r.added_by}`);
          } catch (err) {
            console.error('Failed to send scheduled reminder', err);
          }
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  }, freq * 1000);
}

function stopScheduler() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

export { startScheduler, stopScheduler };
export default { startScheduler, stopScheduler };
