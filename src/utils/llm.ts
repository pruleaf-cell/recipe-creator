import type {
  AiSettings,
  Allergen,
  DietaryTag,
  Equipment,
  Ingredient,
  MethodStep,
  Preferences,
  Recipe,
  Unit,
} from '../types'
import { ALLERGEN_OPTIONS, DIETARY_OPTIONS, UNIT_OPTIONS } from './recipeEngine'

export interface RecipeRequestInput {
  pantryItems: string[]
  preferences: Preferences
  goal: string
  recipeCount: number
  settings: AiSettings
  refinementContext?: {
    recipe: Recipe
    instruction: string
  }
}

const difficultyValues = ['Easy', 'Medium', 'Hard'] as const
const equipmentValues: Equipment[] = ['hob', 'oven', 'air-fryer']

const allowedUnitSet = new Set<Unit>(UNIT_OPTIONS)
const allowedDietarySet = new Set<DietaryTag>(DIETARY_OPTIONS)
const allowedAllergenSet = new Set<Allergen>(ALLERGEN_OPTIONS)
const allowedEquipmentSet = new Set<Equipment>(equipmentValues)

const schema = {
  name: 'recipe_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      assistantSummary: { type: 'string' },
      recipes: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            cuisine: { type: 'string' },
            difficulty: { type: 'string', enum: [...difficultyValues] },
            cookTimeMinutes: { type: 'number' },
            servings: { type: 'number' },
            dietaryTags: {
              type: 'array',
              items: { type: 'string', enum: [...DIETARY_OPTIONS] },
            },
            allergens: {
              type: 'array',
              items: { type: 'string', enum: [...ALLERGEN_OPTIONS] },
            },
            equipment: {
              type: 'array',
              items: { type: 'string', enum: [...equipmentValues] },
            },
            ingredients: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'number' },
                  unit: { type: 'string', enum: [...UNIT_OPTIONS] },
                  optional: { type: 'boolean' },
                  notes: { type: 'string' },
                },
                required: ['name', 'quantity', 'unit', 'optional', 'notes'],
                additionalProperties: false,
              },
            },
            steps: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  timerMinutes: { type: 'number' },
                  notes: { type: 'string' },
                  temperatureC: { type: 'number' },
                  gasMark: { type: 'string' },
                },
                required: ['text', 'timerMinutes', 'notes', 'temperatureC', 'gasMark'],
                additionalProperties: false,
              },
            },
            swapSuggestions: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              items: { type: 'string' },
            },
            tips: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: { type: 'string' },
            },
          },
          required: [
            'title',
            'description',
            'cuisine',
            'difficulty',
            'cookTimeMinutes',
            'servings',
            'dietaryTags',
            'allergens',
            'equipment',
            'ingredients',
            'steps',
            'swapSuggestions',
            'tips',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['assistantSummary', 'recipes'],
    additionalProperties: false,
  },
} as const

interface RecipeResponsePayload {
  assistantSummary: string
  recipes: Array<Partial<Recipe>>
}

const normalizeString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback

const normalizeNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

const normalizeIngredient = (raw: unknown): Ingredient | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<Ingredient>
  const name = normalizeString(candidate.name)
  if (!name) {
    return null
  }

  const unit = allowedUnitSet.has(candidate.unit as Unit) ? (candidate.unit as Unit) : 'g'

  return {
    name,
    quantity: Math.max(0, normalizeNumber(candidate.quantity, 0)),
    unit,
    optional: Boolean(candidate.optional),
    notes: normalizeString(candidate.notes),
  }
}

const normalizeStep = (raw: unknown): MethodStep | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<MethodStep>
  const text = normalizeString(candidate.text)
  if (!text) {
    return null
  }

  const timerMinutes = normalizeNumber(candidate.timerMinutes, 0)
  const temperatureC = normalizeNumber(candidate.temperatureC, 0)

  return {
    text,
    timerMinutes: timerMinutes > 0 ? timerMinutes : undefined,
    notes: normalizeString(candidate.notes),
    temperatureC: temperatureC > 0 ? temperatureC : undefined,
    gasMark: normalizeString(candidate.gasMark),
  }
}

const normalizeRecipe = (rawRecipe: Partial<Recipe>, index: number): Recipe => {
  const ingredients = Array.isArray(rawRecipe.ingredients)
    ? rawRecipe.ingredients.map(normalizeIngredient).filter((value): value is Ingredient => Boolean(value))
    : []

  const steps = Array.isArray(rawRecipe.steps)
    ? rawRecipe.steps.map(normalizeStep).filter((value): value is MethodStep => Boolean(value))
    : []

  return {
    id: `llm-${crypto.randomUUID()}`,
    title: normalizeString(rawRecipe.title, `AI Recipe ${index + 1}`),
    description: normalizeString(rawRecipe.description, 'AI-generated recipe.'),
    cuisine: normalizeString(rawRecipe.cuisine, 'Fusion'),
    difficulty: difficultyValues.includes(rawRecipe.difficulty as Recipe['difficulty'])
      ? (rawRecipe.difficulty as Recipe['difficulty'])
      : 'Easy',
    cookTimeMinutes: Math.max(5, normalizeNumber(rawRecipe.cookTimeMinutes, 30)),
    servings: Math.max(1, normalizeNumber(rawRecipe.servings, 4)),
    dietaryTags: Array.isArray(rawRecipe.dietaryTags)
      ? rawRecipe.dietaryTags.filter((tag): tag is DietaryTag => allowedDietarySet.has(tag as DietaryTag))
      : [],
    allergens: Array.isArray(rawRecipe.allergens)
      ? rawRecipe.allergens.filter((item): item is Allergen => allowedAllergenSet.has(item as Allergen))
      : [],
    equipment: Array.isArray(rawRecipe.equipment)
      ? rawRecipe.equipment.filter((item): item is Equipment => allowedEquipmentSet.has(item as Equipment))
      : ['hob'],
    ingredients: ingredients.length > 0 ? ingredients : [{ name: 'water', quantity: 500, unit: 'ml' }],
    steps:
      steps.length > 0
        ? steps
        : [
            { text: 'Prepare your ingredients and season to taste.' },
            { text: 'Cook until done and serve hot.' },
          ],
    swapSuggestions: Array.isArray(rawRecipe.swapSuggestions)
      ? rawRecipe.swapSuggestions.map((swap) => normalizeString(swap)).filter(Boolean)
      : [],
    tips: Array.isArray(rawRecipe.tips)
      ? rawRecipe.tips.map((tip) => normalizeString(tip)).filter(Boolean)
      : [],
    source: 'llm',
  }
}

const extractJsonFromText = (rawText: string): RecipeResponsePayload => {
  const directParse = (() => {
    try {
      return JSON.parse(rawText) as RecipeResponsePayload
    } catch {
      return null
    }
  })()

  if (directParse) {
    return directParse
  }

  const codeFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeFenceMatch?.[1]) {
    return JSON.parse(codeFenceMatch[1]) as RecipeResponsePayload
  }

  const start = rawText.indexOf('{')
  const end = rawText.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(rawText.slice(start, end + 1)) as RecipeResponsePayload
  }

  throw new Error('Model response did not include JSON.')
}

const formatContext = (preferences: Preferences, pantryItems: string[]): string => {
  const equipmentText = preferences.equipment.length > 0 ? preferences.equipment.join(', ') : 'any'
  const dietaryText = preferences.dietary.length > 0 ? preferences.dietary.join(', ') : 'none'
  const allergenText =
    preferences.allergensToAvoid.length > 0 ? preferences.allergensToAvoid.join(', ') : 'none'

  return [
    `Pantry items: ${pantryItems.length > 0 ? pantryItems.join(', ') : 'none listed'}`,
    `Target servings: ${preferences.servings}`,
    `Max cook time: ${preferences.maxCookTime} minutes`,
    `Cuisine preference: ${preferences.cuisine || 'any'}`,
    `Dietary requirements: ${dietaryText}`,
    `Allergens to avoid: ${allergenText}`,
    `Equipment available: ${equipmentText}`,
  ].join('\n')
}

const systemPrompt = `You are an elite UK-focused recipe designer.
Always return practical home-cook recipes with exact UK units (g, kg, ml, litres, tbsp, tsp).
Oven instructions must include temperature in Celsius and Gas Mark where relevant.
Respect dietary and allergen constraints strictly.
Use pantry ingredients aggressively and clearly indicate swaps and chef tips.
Return only the requested JSON.`

const buildUserPrompt = (input: RecipeRequestInput): string => {
  const basePrompt = [
    `Create ${Math.max(1, Math.min(6, input.recipeCount))} highly creative but realistic recipe options.`,
    `Primary request: ${input.goal || 'Invent high-impact weeknight meals with layered flavor.'}`,
    formatContext(input.preferences, input.pantryItems),
    'Quality bar:',
    '- Every recipe should feel distinct in flavor and format.',
    '- Keep ingredient quantities coherent with servings.',
    '- Include missing-ingredient aware swaps.',
    '- Keep methods concise but chef-level useful.',
  ]

  if (!input.refinementContext) {
    return basePrompt.join('\n')
  }

  return [
    ...basePrompt,
    '',
    'Refinement task:',
    `Take this recipe as baseline and transform it according to instruction:`,
    `Instruction: ${input.refinementContext.instruction}`,
    `Baseline recipe JSON:\n${JSON.stringify(input.refinementContext.recipe, null, 2)}`,
    'You may return one improved recipe or multiple variants.',
  ].join('\n')
}

const readContentFromResponse = (responseJson: unknown): string => {
  if (!responseJson || typeof responseJson !== 'object') {
    throw new Error('Unexpected API response shape.')
  }

  const candidate = responseJson as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    output_text?: string
  }

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text
  }

  const messageContent = candidate.choices?.[0]?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) {
    return messageContent
  }

  if (Array.isArray(messageContent)) {
    const textChunks = messageContent
      .map((entry) => (entry && typeof entry === 'object' ? normalizeString(entry.text) : ''))
      .filter(Boolean)

    if (textChunks.length > 0) {
      return textChunks.join('\n')
    }
  }

  throw new Error('No model message content found.')
}

const buildRequestBody = (input: RecipeRequestInput, withSchema: boolean): Record<string, unknown> => {
  const request: Record<string, unknown> = {
    model: input.settings.model,
    temperature: Math.max(0, Math.min(1.2, input.settings.creativity)),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserPrompt(input) },
    ],
  }

  if (withSchema) {
    request.response_format = { type: 'json_schema', json_schema: schema }
  }

  return request
}

const callModel = async (input: RecipeRequestInput, withSchema: boolean): Promise<string> => {
  const response = await fetch(input.settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.settings.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(input, withSchema)),
  })

  const responseBody = await response.text()
  if (!response.ok) {
    throw new Error(`LLM request failed (${response.status}): ${responseBody.slice(0, 350)}`)
  }

  const parsed = JSON.parse(responseBody) as unknown
  return readContentFromResponse(parsed)
}

export const generateRecipesWithLlm = async (
  input: RecipeRequestInput,
): Promise<{ recipes: Recipe[]; assistantSummary: string }> => {
  const firstAttempt = async (): Promise<RecipeResponsePayload> => {
    const text = await callModel(input, true)
    return extractJsonFromText(text)
  }

  const fallbackAttempt = async (): Promise<RecipeResponsePayload> => {
    const text = await callModel(input, false)
    return extractJsonFromText(text)
  }

  let payload: RecipeResponsePayload

  try {
    payload = await firstAttempt()
  } catch {
    payload = await fallbackAttempt()
  }

  const normalizedRecipes = Array.isArray(payload.recipes)
    ? payload.recipes.map((recipe, index) => normalizeRecipe(recipe, index))
    : []

  if (normalizedRecipes.length === 0) {
    throw new Error('Model returned no usable recipes.')
  }

  return {
    recipes: normalizedRecipes.slice(0, Math.max(1, Math.min(6, input.recipeCount))),
    assistantSummary: normalizeString(payload.assistantSummary, 'Recipes generated successfully.'),
  }
}

export const __testOnly = {
  extractJsonFromText,
  normalizeRecipe,
}
