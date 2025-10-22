// SEKARANG DAH ADA MODEL GPT YAAA

// LIST MODEL: brainxiex, miaw, cecep, gpt

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'BarqahGantengBangetGilaGantengnyaBikinTergilaGilaBangetSumpah',
  baseURL: 'https://xiex.my.id/api/ai',
});

export const responAI = async (chatMessage, sessID) => {
  try {
    const stream = await client.chat.completions.create({
      // LIST MODEL: brainxiex, miaw, cecep, gpt
      model: 'gpt',
      messages: [{ role: 'user', content: chatMessage }],
      stream: false,
      sessionID: sessID,
    });

    const jawabanAI = stream.message.content; // Mengambil hasil dari AI
    // console.log('Jawaban dari AI:', jawabanAI);
    
    return jawabanAI; // Mengembalikan hasil AI
  } catch (error) {
    console.error('Error from AI:', error);
    throw new Error('Gagal mendapatkan respons dari AI');
  }
};
