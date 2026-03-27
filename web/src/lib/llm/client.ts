import OpenAI from 'openai'

export const llm = new OpenAI({
  baseURL: process.env.LLM_ENDPOINT || 'http://127.0.0.1:8080/v1',
  apiKey: process.env.LLM_API_KEY || 'pwd',
})

export const MODEL = process.env.LLM_MODEL || 'gpt-5.4'
