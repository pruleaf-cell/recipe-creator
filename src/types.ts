export type Unit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'litres'
  | 'tbsp'
  | 'tsp'
  | 'clove'
  | 'whole'
  | 'pinch'
  | 'slice'
  | 'can'
  | 'cup'

export type Difficulty = 'Easy' | 'Medium' | 'Hard'

export type DietaryTag = 'vegetarian' | 'vegan' | 'gluten-free'

export type Allergen =
  | 'dairy'
  | 'eggs'
  | 'fish'
  | 'gluten'
  | 'nuts'
  | 'shellfish'
  | 'soy'

export type Equipment = 'hob' | 'oven' | 'air-fryer'

export interface Ingredient {
  name: string
  quantity: number
  unit: Unit
  optional?: boolean
  notes?: string
}

export interface MethodStep {
  text: string
  timerMinutes?: number
  notes?: string
}

export interface Recipe {
  id: string
  title: string
  description: string
  cuisine: string
  difficulty: Difficulty
  cookTimeMinutes: number
  servings: number
  dietaryTags: DietaryTag[]
  allergens: Allergen[]
  equipment: Equipment[]
  ingredients: Ingredient[]
  steps: MethodStep[]
  swapSuggestions: string[]
  source?: 'base' | 'custom' | 'shared'
}

export interface Preferences {
  servings: number
  maxCookTime: number
  cuisine: string
  dietary: DietaryTag[]
  allergensToAvoid: Allergen[]
  equipment: Equipment[]
}
