import axios from 'axios';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

dotenv.config();

// Fungsi untuk memformat tanggal ke format DD-MM-YYYY
const formatTanggal = (tanggal) => {
  return dayjs(tanggal).format('DD-MM-YYYY');
};

export async function fetchData(opts = {}) {
  let result = '';

  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) {
    return 'Error: EDLINK_BEARER belum diset di file .env';
  }

  try {
    const response = await axios.get('https://api.edlink.id/api/v1.4/account/weekly-schedules', {
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization: `Bearer ${bearer}`,
        'x-app-locale': 'id',
        'user-agent': 'Mozilla/5.0',
      },
    });

    if (!response.data.data || response.data.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali') {
      return 'Error: Authorization token tidak valid atau sesi berakhir.';
    }

    for (const hariData of response.data.data) {
      const tanggal = formatTanggal(hariData.date);
      const hari = hariData.day;

      if (!hariData.sections || hariData.sections.length === 0) {
        result += `Tanggal: ${tanggal}\nHari: ${hari}\nTidak ada perkuliahan.\n\n`;
        continue;
      }

      for (const section of hariData.sections) {
        const matkul = section.group?.name ?? '-';
        const kelas = section.group?.className ?? '-';
        const metode = section.learningMethod ?? '-';
        const mulai = section.startedAt?.split(' ')[1] ?? '-';
        const selesai = section.endedAt?.split(' ')[1] ?? '-';
        const ruang = section.room ?? '-';
        const status = section.progressLabel ?? 'Belum selesai';
        const pertemuan = section.meet ?? '-';

        result += `Tanggal: ${tanggal}\nHari: ${hari}\nPertemuan: ${pertemuan}\nStatus: ${status}\nMata Kuliah: ${matkul} - ${kelas} (${metode})\nJam: ${mulai} - ${selesai}\nRuangan: ${ruang}\n\n`;
      }
    }

    return result;
  } catch (error) {
    console.error(error);
    return `Terjadi kesalahan saat mengambil data.\nError: ${error}`;
  }
}
