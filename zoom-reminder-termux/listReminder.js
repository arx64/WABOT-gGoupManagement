import db from './db.js';

export const listReminders = async (numberUser) => {
  // Mengambil semua data dari tabel `reminders`
  const reminders = await db('reminders').select('*').where('added_by', '=', numberUser);

  if (reminders.length === 0) {
    return 'Tidak ada jadwal yang tersedia saat ini.\nSilakan tambahkan jadwal terlebih dahulu dengan cara:\n*/add "Mata Kuliah" <Zoom Link> <Jam> <Hari>*';
  }

  const dayMap = {
    Mon: 'Senin',
    Tue: 'Selasa',
    Wed: 'Rabu',
    Thu: 'Kamis',
    Fri: 'Jumat',
    Sat: 'Sabtu',
    Sun: 'Minggu',
  };

  // Fungsi untuk mengonversi hari-hari dari bahasa Indonesia ke bahasa Inggris
  const convertDaysToIndonesian = (days) => {
    return days
      .split(', ')
      .map((day) => dayMap[day.trim()] || day)
      .join(', ');
  };

  // Format hasil menjadi string untuk dikirim ke WhatsApp
  let message = 'Daftar Jadwal Mata Kuliah:\n\n';
  reminders.forEach((reminder, index) => {
    message += `ID: ${reminder.id}\n`;
    message += `${index + 1}. Mata Kuliah: ${reminder.course_name}\n`;
    message += `   Link Zoom: ${reminder.zoom_link}\n`;
    message += `   Jam: ${reminder.reminder_time}\n`;
    message += `   Hari: ${convertDaysToIndonesian(reminder.days)}\n\n`;
  });

  return message;
};

export default listReminders;
