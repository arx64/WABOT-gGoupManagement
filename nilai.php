<?php
/**
 * FULL SCRIPT EDlink API Fetch & Parser
 * ------------------------------------
 * - Request API (curl -> PHP)
 * - Parse response JSON
 * - Extract important fields
 * - Output clean JSON
 */

// ==========================
// CONFIG
// ==========================
$TOKEN = "43d772f6ed0988dfd61d393db2e162c0e13ba10991f348564b91036d3d8c2116e7fe881b4b36f155482ac5ac476aca1842da324a3ed7bb268c3b8dba998549dc1";
$GROUP_ID = 1529968;

$URL = "https://api.edlink.id/api/v1.4/post/group/{$GROUP_ID}?comment=true";

// ==========================
// PAYLOAD
// ==========================
$payload = [
    "dataProvider" => json_encode([
        "criterion" => [
            [
                "operator" => "EQ",
                "value" => "Q,1",
                "criteria" => "type"
            ],
            [
                "operator" => "LK",
                "value" => "",
                "criteria" => "title,description"
            ]
        ],
        "page" => [
            "count" => 0,
            "current" => 1,
            "limit" => 10,
            "next" => 0,
            "previous" => 0,
            "total" => 0
        ],
        "sort" => []
    ]),
    "group_team_id" => null
];

// ==========================
// HEADERS
// ==========================
$headers = [
    "Accept: application/json, text/plain, */*",
    "Content-Type: application/json",
    "Authorization: Bearer {$TOKEN}",
    "X-App-Locale: id",
    "X-Referer: https://edlink.id/panel/classes/{$GROUP_ID}/assignments"
];

// ==========================
// CURL REQUEST
// ==========================
$ch = curl_init($URL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_TIMEOUT => 30
]);

$response = curl_exec($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode([
        "error" => "Curl error",
        "message" => curl_error($ch)
    ]);
    exit;
}

curl_close($ch);

// ==========================
// DECODE JSON
// ==========================
$json = json_decode($response, true);

if (!isset($json['data']['data'])) {
    http_response_code(500);
    echo json_encode([
        "error" => "Invalid response structure",
        "raw_response" => $json
    ]);
    exit;
}

// ==========================
// PARSE DATA
// ==========================
$output = [];

foreach ($json['data']['data'] as $post) {

    $output[] = [
        // IDENTITAS
        "id" => $post['id'],
        "title" => $post['title'],
        "type" => $post['type'],
        "status" => $post['status'],

        // WAKTU
        "createdAtTimestamp" => $post['createdAtTimestamp'],
        "updatedAtTimestamp" => $post['updatedAtTimestamp'],
        "updatedAtHuman" => date(
            "Y-m-d H:i:s",
            $post['updatedAtTimestamp']
        ),

        // AKTIVITAS
        "lastActivity" => $post['lastActivity'],
        "commentCount" => $post['commentCount'],

        // PENILAIAN (AMAN DARI NULL)
        "grade" => $post['lecturerQuestion']['grade'] ?? null,
        "isGraded" => $post['lecturerQuestion']['isGraded'] ?? null,
        "answererCount" => $post['teacherQuestion']['answererCount'] ?? null,
        "dueDateTimestamp" => $post['teacherQuestion']['dueDateTimestamp'] ?? null,

        // DOSEN
        "lecturer" => $post['user']['name'] ?? null,

        // KELAS
        "className" => $post['group']['className'] ?? null,
        "courseName" => $post['group']['name'] ?? null
    ];
}

// ==========================
// OUTPUT
// ==========================
header("Content-Type: application/json; charset=utf-8");
echo json_encode([
    "total" => count($output),
    "generated_at" => date("Y-m-d H:i:s"),
    "data" => $output
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
