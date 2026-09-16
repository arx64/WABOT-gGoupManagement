import axios from 'axios';

const BASE_URL = 'https://api.wolvesville.com';

function getHeaders() {
  const apiKey = process.env.WOLVESVILLE_API_KEY;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bot ${apiKey}`;
  }

  return headers;
}

export async function fetchRoles(locale = 'id') {
  const response = await axios.get(`${BASE_URL}/roles`, {
    headers: getHeaders(),
    params: { locale },
  });

  return response.data;
}

export async function searchPlayer(username) {
  const response = await axios.get(`${BASE_URL}/players/search`, {
    headers: getHeaders(),
    params: { username },
  });

  return response.data;
}

export async function getPlayer(playerId) {
  const response = await axios.get(`${BASE_URL}/players/${playerId}`, {
    headers: getHeaders(),
  });

  return response.data;
}

export async function searchClan(name, options = {}) {
  const response = await axios.get(`${BASE_URL}/clans/search`, {
    headers: getHeaders(),
    params: {
      name,
      ...options,
    },
  });

  return response.data;
}

export async function getAuthorizedClans() {
  const response = await axios.get(`${BASE_URL}/clans/authorized`, {
    headers: getHeaders(),
  });

  return response.data;
}

export async function getClanInfo(clanId) {
  const response = await axios.get(`${BASE_URL}/clans/${clanId}/info`, {
    headers: getHeaders(),
  });

  return response.data;
}

export async function getClanMembers(clanId) {
  const response = await axios.get(`${BASE_URL}/clans/${clanId}/members`, {
    headers: getHeaders(),
  });

  return response.data;
}

export async function getRoleRotations(locale = 'id') {
  const response = await axios.get(`${BASE_URL}/roleRotations`, {
    headers: getHeaders(),
    params: { locale },
  });

  return response.data;
}

export async function getAnnouncements() {
  const response = await axios.get(`${BASE_URL}/announcements`, {
    headers: getHeaders(),
  });

  return response.data;
}
