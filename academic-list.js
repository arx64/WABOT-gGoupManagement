const axios = require('axios');

const headers = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  authorization: 'Bearer 1c4f782b136428dfd61d393db2e162c0e13ba10991f34203a1c77693734024b3e7fe881b4b36f155482ac5ac476aca1847051be66dedc5f5d424929ac56bcf724',
  'cache-control': 'no-cache',
  dnt: '1',
  origin: 'https://edlink.id',
  pragma: 'no-cache',
  referer: 'https://edlink.id/',
  'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'x-gmid': '23911331',
};

axios
  .post('https://api.edlink.id/api/v1.4/group/academic-lists', {}, { headers })
  .then((response) => {
    // console.log(JSON.stringify(response.data.data, null, 2)); // Untuk menampilkan dengan format yang rapi
    for (let i = 0; i < response.data.data.length; i++) {
      console.log(`ID: ${response.data.data[i].id} \nName: ${response.data.data[i].name} \nclassName: ${response.data.data[i].className}\n\n`);
    }
  })
  .catch((error) => {
    console.error(error);
  });
