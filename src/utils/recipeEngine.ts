import type {
  Allergen,
  DietaryTag,
  Ingredient,
  Preferences,
  Recipe,
  Unit,
} from '../types'

export const UNIT_OPTIONS: Unit[] = [
  'g',
  'kg',
  'ml',
  'litres',
  'tbsp',
  'tsp',
  'clove',
  'whole',
  'pinch',
  'slice',
  'can',
  'cup',
]

export const ALLERGEN_OPTIONS: Allergen[] = [
  'dairy',
  'eggs',
  'fish',
  'gluten',
  'nuts',
  'shellfish',
  'soy',
]

export const DIETARY_OPTIONS: DietaryTag[] = ['vegetarian', 'vegan', 'gluten-free']

export const PANTRY_SUGGESTIONS = [
  'onion',
  'garlic',
  'olive oil',
  'chopped tomatoes',
  'rice',
  'pasta',
  'potatoes',
  'eggs',
  'chickpeas',
  'black beans',
  'lentils',
  'cheddar',
  'milk',
  'flour',
  'butter',
  'spinach',
  'carrot',
  'coconut milk',
  'soy sauce',
  'lemon',
]

const swapDictionary: Record<string, string> = {
  yogurt: 'Swap yogurt for creme fraiche, or coconut yogurt for dairy-free.',
  yoghurt: 'Swap yoghurt for creme fraiche, or coconut yoghurt for dairy-free.',
  'creme fraiche': 'Swap creme fraiche for Greek yogurt or oat creme for dairy-free.',
  milk: 'Swap milk for oat milk or soy milk 1:1.',
  butter: 'Swap butter for olive oil or plant-based baking block.',
  cream: 'Swap cream for creme fraiche, or oat cream for dairy-free.',
  egg: 'Swap each egg for 1 tbsp ground flaxseed plus 3 tbsp water in binding recipes.',
  eggs: 'Swap eggs for flaxseed gel when binding is needed.',
  cheddar: 'Swap cheddar for a mature dairy-free cheese alternative.',
  parmesan: 'Swap parmesan for nutritional yeast plus a pinch of salt.',
  tofu: 'Swap tofu for chickpeas in stews and curries.',
  chickpeas: 'Swap chickpeas for cannellini beans or butter beans.',
  flour: 'Swap plain flour for a gluten-free flour blend.',
  pasta: 'Swap wheat pasta for gluten-free pasta made with maize and rice.',
}

const normaliseText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const containsToken = (source: string, token: string): boolean => {
  const normalizedSource = ` ${normaliseText(source)} `
  const normalizedToken = ` ${normaliseText(token)} `
  return normalizedSource.includes(normalizedToken)
}

const dietarySatisfied = (recipe: Recipe, requested: DietaryTag[]): boolean => {
  if (requested.length === 0) {
    return true
  }

  return requested.every((tag) => {
    if (tag === 'vegetarian') {
      return recipe.dietaryTags.includes('vegetarian') || recipe.dietaryTags.includes('vegan')
    }

    return recipe.dietaryTags.includes(tag)
  })
}

const equipmentSatisfied = (recipe: Recipe, available: Preferences['equipment']): boolean => {
  if (available.length === 0) {
    return true
  }

  return recipe.equipment.every((item) => available.includes(item))
}

const cuisineSatisfied = (recipe: Recipe, cuisine: string): boolean => {
  if (!cuisine.trim()) {
    return true
  }

  return normaliseText(recipe.cuisine).includes(normaliseText(cuisine))
}

const allergenSatisfied = (recipe: Recipe, blocked: Allergen[]): boolean => {
  if (blocked.length === 0) {
    return true
  }

  return !recipe.allergens.some((allergen) => blocked.includes(allergen))
}

export const normalisePantryItems = (pantryItems: string[]): string[] => {
  const seen = new Set<string>()
  const cleaned: string[] = []

  pantryItems.forEach((item) => {
    const normalized = normaliseText(item)
    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    cleaned.push(item.trim())
  })

  return cleaned
}

export const hasIngredient = (ingredientName: string, pantryItems: string[]): boolean => {
  if (pantryItems.length === 0) {
    return false
  }

  return pantryItems.some((item) => {
    const normalizedPantry = normaliseText(item)
    const normalizedIngredient = normaliseText(ingredientName)

    return (
      containsToken(normalizedPantry, normalizedIngredient) ||
      containsToken(normalizedIngredient, normalizedPantry)
    )
  })
}

export const missingIngredients = (recipe: Recipe, pantryItems: string[]): Ingredient[] =>
  recipe.ingredients.filter((ingredient) => !hasIngredient(ingredient.name, pantryItems))

export const pantryFitPercent = (recipe: Recipe, pantryItems: string[]): number => {
  if (recipe.ingredients.length === 0) {
    return 0
  }

  const missingCount = missingIngredients(recipe, pantryItems).length
  const fit = ((recipe.ingredients.length - missingCount) / recipe.ingredients.length) * 100
  return Math.max(0, Math.min(100, Math.round(fit)))
}

export const buildShoppingList = (recipes: Recipe[], pantryItems: string[]): string[] => {
  const neededItems = new Set<string>()

  recipes.forEach((recipe) => {
    missingIngredients(recipe, pantryItems).forEach((ingredient) => {
      neededItems.add(ingredient.name)
    })
  })

  return Array.from(neededItems).sort((a, b) => a.localeCompare(b))
}

export const buildSwapSuggestions = (
  recipe: Recipe,
  dietary: DietaryTag[],
  pantryItems: string[],
): string[] => {
  const suggestions = new Set<string>(recipe.swapSuggestions)

  recipe.ingredients.forEach((ingredient) => {
    const name = normaliseText(ingredient.name)
    Object.entries(swapDictionary).forEach(([key, suggestion]) => {
      if (name.includes(key)) {
        suggestions.add(suggestion)
      }
    })
  })

  if (dietary.includes('vegan')) {
    suggestions.add('For creamy sauces, use oat cream or blended cashews instead of dairy.')
  }

  const missing = missingIngredients(recipe, pantryItems)
  if (missing.length > 0) {
    suggestions.add('Missing an ingredient? Try a same-family swap (bean for bean, herb for herb).')
  }

  return Array.from(suggestions).slice(0, 6)
}

const scoreRecipe = (
  recipe: Recipe,
  pantryItems: string[],
  preferences: Preferences,
): { score: number; strictMatch: boolean; recipe: Recipe } => {
  const ingredientTotal = recipe.ingredients.length
  const missingTotal = missingIngredients(recipe, pantryItems).length
  const pantryCoverage = ingredientTotal === 0 ? 0 : (ingredientTotal - missingTotal) / ingredientTotal

  const timeMatch = recipe.cookTimeMinutes <= preferences.maxCookTime
  const cuisineMatch = cuisineSatisfied(recipe, preferences.cuisine)
  const dietaryMatch = dietarySatisfied(recipe, preferences.dietary)
  const equipmentMatch = equipmentSatisfied(recipe, preferences.equipment)

  let score = pantryCoverage * 100
  score += timeMatch ? 12 : Math.max(-12, (preferences.maxCookTime - recipe.cookTimeMinutes) / 5)
  score += cuisineMatch ? 8 : -4
  score += dietaryMatch ? 10 : -50
  score += equipmentMatch ? 8 : -30

  return {
    recipe,
    score,
    strictMatch: timeMatch && cuisineMatch && dietaryMatch && equipmentMatch,
  }
}

export const generateRecipeOptions = (
  recipes: Recipe[],
  pantryItems: string[],
  preferences: Preferences,
): Recipe[] => {
  const allergenSafe = recipes.filter((recipe) => allergenSatisfied(recipe, preferences.allergensToAvoid))

  const scored = allergenSafe
    .map((recipe) => scoreRecipe(recipe, pantryItems, preferences))
    .sort((a, b) => b.score - a.score)

  const selected: Recipe[] = scored
    .filter((entry) => entry.strictMatch)
    .slice(0, 6)
    .map((entry) => entry.recipe)

  if (selected.length < 3) {
    scored.forEach((entry) => {
      if (selected.length >= 6) {
        return
      }

      if (!selected.find((recipe) => recipe.id === entry.recipe.id)) {
        selected.push(entry.recipe)
      }
    })
  }

  if (selected.length < 3) {
    return allergenSafe.slice(0, Math.min(3, allergenSafe.length))
  }

  return selected.slice(0, 6)
}

const roundQuantity = (value: number): number => {
  if (value >= 50) {
    return Math.round(value)
  }

  if (value >= 10) {
    return Math.round(value * 2) / 2
  }

  return Math.round(value * 10) / 10
}

export const scaleIngredients = (
  ingredients: Ingredient[],
  currentServings: number,
  targetServings: number,
): Ingredient[] => {
  if (currentServings <= 0 || targetServings <= 0) {
    return ingredients
  }

  const factor = targetServings / currentServings

  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: roundQuantity(ingredient.quantity * factor),
  }))
}

export const formatIngredient = (ingredient: Ingredient): string => {
  const quantityText = Number.isInteger(ingredient.quantity)
    ? ingredient.quantity.toString()
    : ingredient.quantity.toFixed(1).replace(/\.0$/, '')

  const optionalText = ingredient.optional ? ' (optional)' : ''
  const noteText = ingredient.notes ? `, ${ingredient.notes}` : ''

  return `${quantityText} ${ingredient.unit} ${ingredient.name}${optionalText}${noteText}`
}

export const recipeToPlainText = (
  recipe: Recipe,
  scaledIngredientsList: Ingredient[],
  missingList: Ingredient[],
  swaps: string[],
): string => {
  const lines = [
    `${recipe.title}`,
    `${recipe.description}`,
    `Cuisine: ${recipe.cuisine}`,
    `Difficulty: ${recipe.difficulty}`,
    `Cook time: ${recipe.cookTimeMinutes} minutes`,
    '',
    'Ingredients',
    ...scaledIngredientsList.map((ingredient) => `- ${formatIngredient(ingredient)}`),
    '',
    'Method',
    ...recipe.steps.map((step, index) => `${index + 1}. ${step.text}`),
  ]

  if (missingList.length > 0) {
    lines.push('', "What you're missing")
    missingList.forEach((ingredient) => lines.push(`- ${ingredient.name}`))
  }

  if (swaps.length > 0) {
    lines.push('', 'Swap suggestions')
    swaps.forEach((swap) => lines.push(`- ${swap}`))
  }

  return lines.join('\n')
}

export const isRecipeLike = (value: unknown): value is Recipe => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<Recipe>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.ingredients) &&
    Array.isArray(candidate.steps)
  )
}
