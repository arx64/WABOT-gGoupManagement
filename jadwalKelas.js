const axios = require('axios');
const dayjs = require('dayjs');

// Fungsi untuk memformat tanggal ke format DD-MM-YYYY
const formatTanggal = (tanggal) => {
  return dayjs(tanggal).format('DD-MM-YYYY');
};

// Fungsi untuk melakukan request dan menggabungkan semua output menjadi satu string
async function fetchData() {
  let result = ''; // Variabel untuk menampung semua output

  try {
    const response = await axios.get('https://api.edlink.id/api/v1.4/account/weekly-schedules', {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        authorization: 'Bearer 6723c1f7e863d8dfd61d393db2e162c0e13ba10991f34d6db975f43aa950180027fe881b4b36f155482ac5ac476aca184adc2f0913eed57978c157fa2f2587225',
        'cache-control': 'no-cache',
        dnt: '1',
        origin: 'https://edlink.id',
        pragma: 'no-cache',
        priority: 'u=1, i',
        referer: 'https://edlink.id/',
        'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
    });
  console.log(response.data);
  if (!response.data.data || response.data.applicationSystem.message === 'Silakan refresh halaman Anda atau login kembali') {
    return 'Error: Authorization token tidak valid atau sesi telah berakhir. Silakan login kembali.';
  }

  for (const hariData of response.data.data) {
    const tanggal = formatTanggal(hariData.date);
    const hari = hariData.day;

    if (hariData.sections.length === 0) {
      result += `Tanggal: ${tanggal} \nHari: ${hari} \nTidak ada perkuliahan pada hari ini.\n\n`;
      continue;
    }

    for (const section of hariData.sections) {
      const matkul = section.group.name;
      const kelas = section.group.className;
      const metode = section.learningMethod;
      const mulai = section.startedAt.split(' ')[1];
      const selesai = section.endedAt.split(' ')[1];
      const ruang = section.room;
      const status = section.progressLabel ?? 'Belum selesai';
      const pertemuan = section.meet;

      result += `Tanggal: ${tanggal} \nHari: ${hari} \nPertemuan: ${pertemuan} \nStatus: ${status} \nMata Kuliah: ${matkul} - ${kelas} (${metode}) \nJam: ${mulai} - ${selesai} \nRuangan: ${ruang} \n\n`;
    }
  }
  

    return result;
  } catch (error) {
    console.error(error);
    return `Terjadi kesalahan saat mengambil data\n\n Error: ${error}`;
  }
}

module.exports = { fetchData };
