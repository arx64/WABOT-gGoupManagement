
const wordList = ['komar', 'robot', 'gajah', 'lintas', 'pintar', 'rajin', 'mobil', 'malam', 'santai', 'kamera'];

export function getRandomWord() {
  const word = wordList[Math.floor(Math.random() * wordList.length)];
  const shuffled = word.split('').sort(() => 0.5 - Math.random()).join('');
  return { word, shuffled };
}
