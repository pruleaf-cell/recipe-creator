import { describe, expect, it } from 'vitest'
import { baseRecipes } from '../data/baseRecipes'
import type { Preferences } from '../types'
import {
  generateRecipeOptions,
  missingIngredients,
  scaleIngredients,
} from './recipeEngine'

const preferences: Preferences = {
  servings: 4,
  maxCookTime: 45,
  cuisine: '',
  dietary: [],
  allergensToAvoid: [],
  equipment: [],
}

describe('recipeEngine', () => {
  it('generates between three and six recipe options when enough recipes exist', () => {
    const results = generateRecipeOptions(baseRecipes, ['onion', 'garlic', 'olive oil'], preferences)

    expect(results.length).toBeGreaterThanOrEqual(3)
    expect(results.length).toBeLessThanOrEqual(6)
  })

  it('scales ingredient quantities to target servings', () => {
    const [firstRecipe] = baseRecipes
    const scaled = scaleIngredients(firstRecipe.ingredients, firstRecipe.servings, 2)

    expect(scaled[0].quantity).toBe(160)
  })

  it('finds missing ingredients based on pantry list', () => {
    const [firstRecipe] = baseRecipes
    const missing = missingIngredients(firstRecipe, ['dried pasta', 'garlic'])

    expect(missing.some((ingredient) => ingredient.name === 'chopped tomatoes')).toBe(true)
    expect(missing.some((ingredient) => ingredient.name === 'dried pasta')).toBe(false)
  })
})
