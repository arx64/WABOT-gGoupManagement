<?php
$ch = curl_init();
$post = '{"username":"","app_id":"","email":"ilham12nokia@gmail.com","password":"Penusa12345","web_reg_id":null,"device":"{\"secureId\":\"6cc42bb9-274b-42b8-8fa5-e92d617c6c36\",\"name\":\"Chrome\",\"manufacture\":\"Google\",\"model\":\"Chrome\",\"product\":\"Chrome\",\"hardware\":\"Windows 10\",\"version\":\"144.0.0.0\",\"regId\":null}"}';
curl_setopt($ch, CURLOPT_URL, 'https://api.edlink.id/api/v1.4/site/login');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, $post);

$headers = array();
$headers[] = 'Accept: application/json, text/plain, */*';
$headers[] = 'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7';
$headers[] = 'Cache-Control: no-cache';
$headers[] = 'Content-Type: application/json';
$headers[] = 'Dnt: 1';
$headers[] = 'Origin: https://www.edlink.id';
$headers[] = 'Pragma: no-cache';
$headers[] = 'Priority: u=1, i';
$headers[] = 'Referer: https://www.edlink.id/';
$headers[] = 'Sec-Ch-Ua: \"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"';
$headers[] = 'Sec-Ch-Ua-Mobile: ?0';
$headers[] = 'Sec-Ch-Ua-Platform: \"Windows\"';
$headers[] = 'Sec-Fetch-Dest: empty';
$headers[] = 'Sec-Fetch-Mode: cors';
$headers[] = 'Sec-Fetch-Site: same-site';
$headers[] = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
$headers[] = 'X-App-Locale: id';
$headers[] = 'X-Referer: https://www.edlink.id/login';
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$result = curl_exec($ch);
if (curl_errno($ch)) {
    echo 'Error:' . curl_error($ch);
}
echo $result;
curl_close($ch);