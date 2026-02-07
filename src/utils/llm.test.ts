import { describe, expect, it, vi } from 'vitest'
import type { AiSettings, Preferences } from '../types'
import { __testOnly, generateRecipesWithLlm } from './llm'

const settings: AiSettings = {
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  creativity: 0.8,
  rememberKey: false,
}

const preferences: Preferences = {
  servings: 4,
  maxCookTime: 45,
  cuisine: 'Italian',
  dietary: ['vegetarian'],
  allergensToAvoid: ['nuts'],
  equipment: ['hob', 'oven'],
}

describe('llm utils', () => {
  it('extracts json inside code fences', () => {
    const parsed = __testOnly.extractJsonFromText(
      `\n\`\`\`json\n{"assistantSummary":"ok","recipes":[]}\n\`\`\``,
    )
    expect(parsed.assistantSummary).toBe('ok')
  })

  it('normalizes incomplete recipe objects', () => {
    const recipe = __testOnly.normalizeRecipe(
      {
        title: ' Test Dish ',
        ingredients: [{ name: 'Water', quantity: 600, unit: 'ml' }],
        steps: [{ text: 'Boil gently' }],
      },
      0,
    )

    expect(recipe.title).toBe('Test Dish')
    expect(recipe.ingredients[0].unit).toBe('ml')
    expect(recipe.steps[0].text).toContain('Boil')
  })

  it('generates normalized recipes from model response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistantSummary: 'Here are your recipes.',
                    recipes: [
                      {
                        title: 'LLM Lentil Bowl',
                        description: 'Hearty lentils and greens.',
                        cuisine: 'Modern British',
                        difficulty: 'Easy',
                        cookTimeMinutes: 28,
                        servings: 4,
                        dietaryTags: ['vegan'],
                        allergens: [],
                        equipment: ['hob'],
                        ingredients: [
                          {
                            name: 'red lentils',
                            quantity: 250,
                            unit: 'g',
                            optional: false,
                            notes: '',
                          },
                        ],
                        steps: [
                          {
                            text: 'Rinse lentils.',
                            timerMinutes: 2,
                            notes: '',
                            temperatureC: 0,
                            gasMark: '',
                          },
                          {
                            text: 'Simmer until tender.',
                            timerMinutes: 20,
                            notes: '',
                            temperatureC: 0,
                            gasMark: '',
                          },
                        ],
                        swapSuggestions: ['Use split peas instead.'],
                        tips: ['Season at the end.'],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
      }),
    )

    const result = await generateRecipesWithLlm({
      pantryItems: ['lentils', 'onion'],
      preferences,
      goal: 'Create a bold lentil dish.',
      recipeCount: 4,
      settings,
    })

    expect(result.assistantSummary).toContain('recipes')
    expect(result.recipes[0].title).toBe('LLM Lentil Bowl')
    expect(result.recipes[0].source).toBe('llm')
  })
})
