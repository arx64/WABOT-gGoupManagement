const db = require('./db'); // Koneksi ke database

// Fungsi untuk menghapus jadwal berdasarkan ID
const deleteReminder = async (id, numberUser) => {
  const deletedRows = await db('reminders')
  .where('id', '=', id)
  .andWhere('added_by', '=', numberUser)
  .del();

  if (deletedRows > 0) {
    console.log(`Jadwal dengan ID ${id} berhasil dihapus.`);
    return `Jadwal dengan ID ${id} berhasil dihapus.`;
  } else {
    console.log(`Jadwal dengan ID ${id} tidak ditemukan.`);
    return `Jadwal dengan ID ${id} tidak ditemukan.`;
  }
};

module.exports = { deleteReminder };
