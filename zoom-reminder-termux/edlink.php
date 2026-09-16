<?php
$ch = curl_init();

curl_setopt($ch, CURLOPT_URL, 'https://api.edlink.id/api/v1.4/media/download/12544656/owned');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_POST, 1);

$headers = array();
$headers[] = 'Accept: application/json, text/plain, */*';
$headers[] = 'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7';
$headers[] = 'Authorization: Bearer 1be2e8c48fe388dfd61d393db2e162c0e13ba10991f34806f9e8e2737681a04477fe881b4b36f155482ac5ac476aca18421861167e087276c605322221fe38fef';
$headers[] = 'Cache-Control: no-cache';
$headers[] = 'Content-Length: 0';
$headers[] = 'Dnt: 1';
$headers[] = 'Origin: https://edlink.id';
$headers[] = 'Pragma: no-cache';
$headers[] = 'Priority: u=1, i';
$headers[] = 'Referer: https://edlink.id/';
$headers[] = '^\"Sec-Ch-Ua: ';
$headers[] = 'Sec-Ch-Ua-Mobile: ?0';
$headers[] = '^\"Sec-Ch-Ua-Platform: ';
$headers[] = 'Sec-Fetch-Dest: empty';
$headers[] = 'Sec-Fetch-Mode: cors';
$headers[] = 'Sec-Fetch-Site: same-site';
$headers[] = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$result = curl_exec($ch);
if (curl_errno($ch)) {
    echo 'Error:' . curl_error($ch);
}
echo $result;
curl_close($ch);