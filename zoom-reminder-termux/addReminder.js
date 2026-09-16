import db from './db.js';

const dayMap = {
  senin: 'Mon',
  selasa: 'Tue',
  rabu: 'Wed',
  kamis: 'Thu',
  jumat: 'Fri',
  sabtu: 'Sat',
  minggu: 'Sun',
};

// Fungsi untuk mengonversi hari-hari dari bahasa Indonesia ke bahasa Inggris
const convertDaysToEnglish = (days) => {
  return days
    .split(', ')
    .map((day) => dayMap[day.trim()] || day)
    .join(', ');
};

export async function addReminder(courseName, zoomLink, reminderTime, days, addedBy) {
  
  const convertedDays = convertDaysToEnglish(days.toLowerCase()); // Ubah hari ke bahasa Inggris
  await db('reminders').insert({
    course_name: courseName,
    zoom_link: zoomLink,
    reminder_time: reminderTime,
    days: convertedDays,
    added_by: addedBy,
  });
  console.log('Jadwal berhasil ditambahkan!');
}

