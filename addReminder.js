const db = require('./db');
const dayMap = {
  Senin: 'Mon',
  Selasa: 'Tue',
  Rabu: 'Wed',
  Kamis: 'Thu',
  Jumat: 'Fri',
  Sabtu: 'Sat',
  Minggu: 'Sun',
};

// Fungsi untuk mengonversi hari-hari dari bahasa Indonesia ke bahasa Inggris
const convertDaysToEnglish = (days) => {
  return days
    .split(', ')
    .map((day) => dayMap[day.trim()] || day)
    .join(', ');
};

const addReminder = async (courseName, zoomLink, reminderTime, days, addedBy) => {
  const convertedDays = convertDaysToEnglish(days); // Ubah hari ke bahasa Inggris
  await db('reminders').insert({
    course_name: courseName,
    zoom_link: zoomLink,
    reminder_time: reminderTime,
    days: convertedDays,
    added_by: addedBy
  });
  console.log('Jadwal berhasil ditambahkan!');
};

module.exports = { addReminder };
