import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import { baseRecipes } from './data/baseRecipes'
import type {
  Equipment,
  Ingredient,
  MethodStep,
  Preferences,
  Recipe,
} from './types'
import { decodeRecipeFromUrl, buildShareUrl } from './utils/share'
import { readStorage, writeStorage } from './utils/storage'
import {
  ALLERGEN_OPTIONS,
  DIETARY_OPTIONS,
  PANTRY_SUGGESTIONS,
  UNIT_OPTIONS,
  buildSwapSuggestions,
  formatIngredient,
  generateRecipeOptions,
  isRecipeLike,
  missingIngredients,
  normalisePantryItems,
  recipeToPlainText,
  scaleIngredients,
} from './utils/recipeEngine'

const STORAGE_KEYS = {
  pantry: 'recipe-creator-pantry-v1',
  preferences: 'recipe-creator-preferences-v1',
  customRecipes: 'recipe-creator-custom-recipes-v1',
}

const defaultPreferences: Preferences = {
  servings: 4,
  maxCookTime: 45,
  cuisine: '',
  dietary: [],
  allergensToAvoid: [],
  equipment: [],
}

const defaultIngredient = (): Ingredient => ({
  name: '',
  quantity: 100,
  unit: 'g',
  notes: '',
  optional: false,
})

const defaultStep = (): MethodStep => ({
  text: '',
  timerMinutes: undefined,
  notes: '',
})

const createEmptyRecipe = (): Recipe => ({
  id: '',
  title: '',
  description: '',
  cuisine: '',
  difficulty: 'Easy',
  cookTimeMinutes: 30,
  servings: 4,
  dietaryTags: [],
  allergens: [],
  equipment: ['hob'],
  ingredients: [defaultIngredient()],
  steps: [defaultStep()],
  swapSuggestions: [],
  source: 'custom',
})

const normalizeImportedRecipe = (recipe: Recipe): Recipe => ({
  ...recipe,
  id: recipe.id || `imported-${crypto.randomUUID()}`,
  title: recipe.title || 'Imported recipe',
  description: recipe.description || 'Imported from JSON/share link.',
  cuisine: recipe.cuisine || 'Custom',
  difficulty: recipe.difficulty || 'Easy',
  cookTimeMinutes: Math.max(5, recipe.cookTimeMinutes || 30),
  servings: Math.max(1, recipe.servings || 4),
  dietaryTags: recipe.dietaryTags ?? [],
  allergens: recipe.allergens ?? [],
  equipment: recipe.equipment?.length ? recipe.equipment : ['hob'],
  ingredients:
    recipe.ingredients?.length > 0
      ? recipe.ingredients.map((ingredient) => ({
          ...ingredient,
          quantity: ingredient.quantity || 0,
          unit: ingredient.unit || 'g',
        }))
      : [defaultIngredient()],
  steps:
    recipe.steps?.length > 0
      ? recipe.steps.map((step) => ({
          ...step,
          text: step.text || '',
        }))
      : [defaultStep()],
  swapSuggestions: recipe.swapSuggestions ?? [],
  source: recipe.source ?? 'custom',
})

const toggleListValue = <T extends string>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

function App() {
  const [activeTab, setActiveTab] = useState<'generator' | 'builder'>('generator')

  const [pantryInput, setPantryInput] = useState('')
  const [pantryItems, setPantryItems] = useState<string[]>(() =>
    readStorage<string[]>(STORAGE_KEYS.pantry, []),
  )
  const [preferences, setPreferences] = useState<Preferences>(() =>
    readStorage<Preferences>(STORAGE_KEYS.preferences, defaultPreferences),
  )
  const [customRecipes, setCustomRecipes] = useState<Recipe[]>(() =>
    readStorage<Recipe[]>(STORAGE_KEYS.customRecipes, []),
  )

  const [generatedRecipes, setGeneratedRecipes] = useState<Recipe[]>([])
  const [sharedRecipe, setSharedRecipe] = useState<Recipe | null>(null)

  const [builderRecipe, setBuilderRecipe] = useState<Recipe>(createEmptyRecipe)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)

  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const allRecipes = useMemo(() => {
    const map = new Map<string, Recipe>()

    ;[...baseRecipes, ...customRecipes, ...(sharedRecipe ? [sharedRecipe] : [])].forEach((recipe) => {
      map.set(recipe.id, recipe)
    })

    return Array.from(map.values())
  }, [customRecipes, sharedRecipe])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.pantry, pantryItems)
  }, [pantryItems])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.preferences, preferences)
  }, [preferences])

  useEffect(() => {
    writeStorage(STORAGE_KEYS.customRecipes, customRecipes)
  }, [customRecipes])

  useEffect(() => {
    const encodedRecipe = new URLSearchParams(window.location.search).get('recipe')
    if (!encodedRecipe) {
      return
    }

    const decoded = decodeRecipeFromUrl(encodedRecipe)
    if (decoded && isRecipeLike(decoded)) {
      const normalized = normalizeImportedRecipe({ ...decoded, source: 'shared' })
      setSharedRecipe(normalized)
      setGeneratedRecipes((existing) => [normalized, ...existing.filter((recipe) => recipe.id !== normalized.id)])
      setStatusMessage('Loaded recipe from share link.')
      return
    }

    setErrorMessage('Could not load recipe from the link.')
  }, [])

  const handleAddPantryItem = (rawItem: string) => {
    const nextItems = normalisePantryItems([...pantryItems, rawItem])
    if (nextItems.length === pantryItems.length) {
      return
    }

    setPantryItems(nextItems)
    setPantryInput('')
  }

  const handlePantrySubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!pantryInput.trim()) {
      return
    }

    handleAddPantryItem(pantryInput)
  }

  const handleGenerateRecipes = () => {
    setErrorMessage('')
    setStatusMessage('')

    const options = generateRecipeOptions(allRecipes, pantryItems, preferences)
    setGeneratedRecipes(options)

    if (options.length === 0) {
      setStatusMessage('No recipes match those constraints yet. Loosen one preference and try again.')
      return
    }

    setStatusMessage(`Generated ${options.length} recipe options.`)
  }

  const downloadRecipeJson = (recipe: Recipe) => {
    const blob = new Blob([JSON.stringify(recipe, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'recipe'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatusMessage(successMessage)
    } catch {
      setErrorMessage('Copy failed. Please copy manually.')
    }
  }

  const handleCopyRecipe = async (recipe: Recipe) => {
    const scaled = scaleIngredients(recipe.ingredients, recipe.servings, preferences.servings)
    const missing = missingIngredients(recipe, pantryItems)
    const swaps = buildSwapSuggestions(recipe, preferences.dietary, pantryItems)
    await copyText(
      recipeToPlainText(recipe, scaled, missing, swaps),
      `Copied ${recipe.title} to clipboard.`,
    )
  }

  const handleCopyShareLink = async (recipe: Recipe) => {
    await copyText(buildShareUrl(recipe), `Copied share link for ${recipe.title}.`)
  }

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const importedList = (Array.isArray(parsed) ? parsed : [parsed])
          .filter((item) => isRecipeLike(item))
          .map((item) => normalizeImportedRecipe({ ...item, source: 'custom' }))

        if (importedList.length === 0) {
          setErrorMessage('Import failed: no valid recipe objects found in the file.')
          return
        }

        setCustomRecipes((existing) => {
          const map = new Map(existing.map((recipe) => [recipe.id, recipe]))
          importedList.forEach((recipe) => map.set(recipe.id, recipe))
          return Array.from(map.values())
        })
        setStatusMessage(`Imported ${importedList.length} recipe(s).`)
        setErrorMessage('')
      } catch {
        setErrorMessage('Import failed: file is not valid JSON.')
      } finally {
        event.target.value = ''
      }
    }

    reader.readAsText(selectedFile)
  }

  const updateBuilderIngredient = (
    index: number,
    key: keyof Ingredient,
    value: string | number | boolean,
  ) => {
    setBuilderRecipe((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, ingredientIndex) => {
        if (ingredientIndex !== index) {
          return ingredient
        }

        return { ...ingredient, [key]: value }
      }),
    }))
  }

  const updateBuilderStep = (index: number, key: keyof MethodStep, value: string | number | undefined) => {
    setBuilderRecipe((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => {
        if (stepIndex !== index) {
          return step
        }

        return { ...step, [key]: value }
      }),
    }))
  }

  const resetBuilder = () => {
    setBuilderRecipe(createEmptyRecipe())
    setEditingRecipeId(null)
  }

  const saveBuilderRecipe = () => {
    setErrorMessage('')

    const cleanTitle = builderRecipe.title.trim()
    const filledIngredients = builderRecipe.ingredients.filter((ingredient) => ingredient.name.trim())
    const filledSteps = builderRecipe.steps.filter((step) => step.text.trim())

    if (!cleanTitle || filledIngredients.length === 0 || filledSteps.length === 0) {
      setErrorMessage('Recipe builder needs a title, at least one ingredient, and one method step.')
      return
    }

    const normalized: Recipe = normalizeImportedRecipe({
      ...builderRecipe,
      id: editingRecipeId ?? `custom-${crypto.randomUUID()}`,
      title: cleanTitle,
      ingredients: filledIngredients,
      steps: filledSteps,
      source: 'custom',
    })

    setCustomRecipes((current) => {
      if (editingRecipeId) {
        return current.map((recipe) => (recipe.id === editingRecipeId ? normalized : recipe))
      }

      return [normalized, ...current]
    })

    resetBuilder()
    setStatusMessage(editingRecipeId ? 'Recipe updated.' : 'Recipe saved to local storage.')
  }

  const editRecipe = (recipe: Recipe) => {
    setActiveTab('builder')
    setEditingRecipeId(recipe.id)
    setBuilderRecipe({
      ...recipe,
      source: 'custom',
      ingredients:
        recipe.ingredients.length > 0 ? recipe.ingredients : [defaultIngredient()],
      steps: recipe.steps.length > 0 ? recipe.steps : [defaultStep()],
    })
  }

  const removeRecipe = (recipeId: string) => {
    setCustomRecipes((current) => current.filter((recipe) => recipe.id !== recipeId))
    if (editingRecipeId === recipeId) {
      resetBuilder()
    }
    setStatusMessage('Recipe removed from local storage.')
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Static app • UK-first units</p>
        <h1>Recipe Creator</h1>
        <p>
          Build meals from what you already have, scale servings instantly, and share recipes with a
          link. Works fully in-browser with no backend.
        </p>
      </header>

      <nav className="tabs" aria-label="App sections">
        <button
          className={activeTab === 'generator' ? 'active' : ''}
          onClick={() => setActiveTab('generator')}
          type="button"
        >
          Generate Recipes
        </button>
        <button
          className={activeTab === 'builder' ? 'active' : ''}
          onClick={() => setActiveTab('builder')}
          type="button"
        >
          Recipe Builder
        </button>
      </nav>

      {statusMessage && (
        <p className="status-message" role="status">
          {statusMessage}
        </p>
      )}
      {errorMessage && (
        <p className="error-message" role="alert">
          {errorMessage}
        </p>
      )}

      {activeTab === 'generator' && (
        <section className="panel-grid">
          <aside className="panel">
            <h2>Pantry</h2>
            <form onSubmit={handlePantrySubmit} className="inline-form">
              <label htmlFor="pantry-input">Add ingredient</label>
              <input
                id="pantry-input"
                value={pantryInput}
                onChange={(event) => setPantryInput(event.target.value)}
                placeholder="e.g. chopped tomatoes"
              />
              <button type="submit">Add</button>
            </form>

            <div className="chip-row" aria-label="Suggested pantry tags">
              {PANTRY_SUGGESTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  onClick={() => handleAddPantryItem(tag)}
                >
                  + {tag}
                </button>
              ))}
            </div>

            {pantryItems.length === 0 ? (
              <p className="empty-state">No pantry items yet. Add a few to improve recipe matching.</p>
            ) : (
              <ul className="list-reset">
                {pantryItems.map((item) => (
                  <li key={item}>
                    <span>{item}</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setPantryItems((current) => current.filter((existingItem) => existingItem !== item))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h2>Preferences</h2>
            <div className="field-grid">
              <label htmlFor="servings">Servings</label>
              <input
                id="servings"
                type="number"
                min={1}
                max={20}
                value={preferences.servings}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    servings: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />

              <label htmlFor="cook-time">Max cook time (minutes)</label>
              <input
                id="cook-time"
                type="number"
                min={10}
                max={240}
                value={preferences.maxCookTime}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    maxCookTime: Math.max(10, Number(event.target.value) || 10),
                  }))
                }
              />

              <label htmlFor="cuisine">Cuisine style (optional)</label>
              <input
                id="cuisine"
                value={preferences.cuisine}
                onChange={(event) =>
                  setPreferences((current) => ({ ...current, cuisine: event.target.value }))
                }
                placeholder="e.g. Italian"
              />
            </div>

            <fieldset>
              <legend>Dietary</legend>
              <div className="checkbox-grid">
                {DIETARY_OPTIONS.map((dietaryTag) => (
                  <label key={dietaryTag}>
                    <input
                      type="checkbox"
                      checked={preferences.dietary.includes(dietaryTag)}
                      onChange={() =>
                        setPreferences((current) => ({
                          ...current,
                          dietary: toggleListValue(current.dietary, dietaryTag),
                        }))
                      }
                    />
                    {dietaryTag}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Allergens to avoid</legend>
              <div className="checkbox-grid">
                {ALLERGEN_OPTIONS.map((allergen) => (
                  <label key={allergen}>
                    <input
                      type="checkbox"
                      checked={preferences.allergensToAvoid.includes(allergen)}
                      onChange={() =>
                        setPreferences((current) => ({
                          ...current,
                          allergensToAvoid: toggleListValue(current.allergensToAvoid, allergen),
                        }))
                      }
                    />
                    {allergen}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Equipment available</legend>
              <div className="checkbox-grid">
                {(['hob', 'oven', 'air-fryer'] satisfies Equipment[]).map((equipment) => (
                  <label key={equipment}>
                    <input
                      type="checkbox"
                      checked={preferences.equipment.includes(equipment)}
                      onChange={() =>
                        setPreferences((current) => ({
                          ...current,
                          equipment: toggleListValue(current.equipment, equipment),
                        }))
                      }
                    />
                    {equipment}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="action-row">
              <button type="button" onClick={handleGenerateRecipes}>
                Generate 3-6 recipes
              </button>
              <label className="import-label" htmlFor="import-recipes">
                Import JSON
              </label>
              <input id="import-recipes" type="file" accept="application/json" onChange={handleImport} />
            </div>
          </aside>

          <div className="panel recipe-results">
            <h2>Recipe options</h2>
            {generatedRecipes.length === 0 ? (
              <p className="empty-state">
                No recipes generated yet. Add pantry items, set preferences, and run generation.
              </p>
            ) : (
              <div className="recipe-grid">
                {generatedRecipes.map((recipe) => {
                  const scaledIngredients = scaleIngredients(
                    recipe.ingredients,
                    recipe.servings,
                    preferences.servings,
                  )
                  const missing = missingIngredients(recipe, pantryItems)
                  const swaps = buildSwapSuggestions(recipe, preferences.dietary, pantryItems)

                  return (
                    <article key={recipe.id} className="recipe-card" aria-label={recipe.title}>
                      <header>
                        <h3>{recipe.title}</h3>
                        <p>{recipe.description}</p>
                        <p className="meta">
                          {recipe.cuisine} • {recipe.difficulty} • {recipe.cookTimeMinutes} min
                        </p>
                      </header>

                      <section>
                        <h4>Ingredients ({preferences.servings} servings)</h4>
                        <ul>
                          {scaledIngredients.map((ingredient, index) => (
                            <li key={`${recipe.id}-ingredient-${index}`}>{formatIngredient(ingredient)}</li>
                          ))}
                        </ul>
                      </section>

                      <section>
                        <h4>Method</h4>
                        <ol>
                          {recipe.steps.map((step, index) => (
                            <li key={`${recipe.id}-step-${index}`}>
                              {step.text}
                              {step.timerMinutes ? ` (${step.timerMinutes} min)` : ''}
                              {step.notes ? ` - ${step.notes}` : ''}
                            </li>
                          ))}
                        </ol>
                      </section>

                      <section>
                        <h4>What you&apos;re missing</h4>
                        {missing.length === 0 ? (
                          <p>Nothing missing from your pantry list.</p>
                        ) : (
                          <ul>
                            {missing.map((ingredient, index) => (
                              <li key={`${recipe.id}-missing-${index}`}>{ingredient.name}</li>
                            ))}
                          </ul>
                        )}
                      </section>

                      <section>
                        <h4>Swap suggestions</h4>
                        <ul>
                          {swaps.map((swap, index) => (
                            <li key={`${recipe.id}-swap-${index}`}>{swap}</li>
                          ))}
                        </ul>
                      </section>

                      <div className="action-row">
                        <button type="button" onClick={() => handleCopyRecipe(recipe)}>
                          Copy recipe
                        </button>
                        <button type="button" onClick={() => downloadRecipeJson(recipe)}>
                          Export JSON
                        </button>
                        <button type="button" onClick={() => handleCopyShareLink(recipe)}>
                          Copy share link
                        </button>
                        {recipe.source !== 'base' && (
                          <button type="button" onClick={() => editRecipe(recipe)}>
                            Edit
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'builder' && (
        <section className="panel-grid">
          <div className="panel">
            <h2>{editingRecipeId ? 'Edit recipe' : 'Create recipe'}</h2>
            <div className="field-grid">
              <label htmlFor="recipe-title">Title</label>
              <input
                id="recipe-title"
                value={builderRecipe.title}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({ ...current, title: event.target.value }))
                }
              />

              <label htmlFor="recipe-description">Short description</label>
              <textarea
                id="recipe-description"
                value={builderRecipe.description}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({ ...current, description: event.target.value }))
                }
              />

              <label htmlFor="recipe-cuisine">Cuisine</label>
              <input
                id="recipe-cuisine"
                value={builderRecipe.cuisine}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({ ...current, cuisine: event.target.value }))
                }
              />

              <label htmlFor="recipe-difficulty">Difficulty</label>
              <select
                id="recipe-difficulty"
                value={builderRecipe.difficulty}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({
                    ...current,
                    difficulty: event.target.value as Recipe['difficulty'],
                  }))
                }
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>

              <label htmlFor="recipe-servings">Servings</label>
              <input
                id="recipe-servings"
                type="number"
                min={1}
                value={builderRecipe.servings}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({
                    ...current,
                    servings: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
              />

              <label htmlFor="recipe-cooktime">Cook time (minutes)</label>
              <input
                id="recipe-cooktime"
                type="number"
                min={5}
                value={builderRecipe.cookTimeMinutes}
                onChange={(event) =>
                  setBuilderRecipe((current) => ({
                    ...current,
                    cookTimeMinutes: Math.max(5, Number(event.target.value) || 5),
                  }))
                }
              />
            </div>

            <fieldset>
              <legend>Dietary tags</legend>
              <div className="checkbox-grid">
                {DIETARY_OPTIONS.map((dietaryTag) => (
                  <label key={dietaryTag}>
                    <input
                      type="checkbox"
                      checked={builderRecipe.dietaryTags.includes(dietaryTag)}
                      onChange={() =>
                        setBuilderRecipe((current) => ({
                          ...current,
                          dietaryTags: toggleListValue(current.dietaryTags, dietaryTag),
                        }))
                      }
                    />
                    {dietaryTag}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Allergens</legend>
              <div className="checkbox-grid">
                {ALLERGEN_OPTIONS.map((allergen) => (
                  <label key={allergen}>
                    <input
                      type="checkbox"
                      checked={builderRecipe.allergens.includes(allergen)}
                      onChange={() =>
                        setBuilderRecipe((current) => ({
                          ...current,
                          allergens: toggleListValue(current.allergens, allergen),
                        }))
                      }
                    />
                    {allergen}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Equipment</legend>
              <div className="checkbox-grid">
                {(['hob', 'oven', 'air-fryer'] satisfies Equipment[]).map((equipment) => (
                  <label key={equipment}>
                    <input
                      type="checkbox"
                      checked={builderRecipe.equipment.includes(equipment)}
                      onChange={() =>
                        setBuilderRecipe((current) => ({
                          ...current,
                          equipment: toggleListValue(current.equipment, equipment),
                        }))
                      }
                    />
                    {equipment}
                  </label>
                ))}
              </div>
            </fieldset>

            <h3>Ingredients</h3>
            <div className="builder-list">
              {builderRecipe.ingredients.map((ingredient, index) => (
                <div className="builder-row" key={`builder-ingredient-${index}`}>
                  <input
                    aria-label={`Ingredient name ${index + 1}`}
                    placeholder="Ingredient"
                    value={ingredient.name}
                    onChange={(event) => updateBuilderIngredient(index, 'name', event.target.value)}
                  />
                  <input
                    aria-label={`Ingredient quantity ${index + 1}`}
                    type="number"
                    min={0}
                    step={0.1}
                    value={ingredient.quantity}
                    onChange={(event) =>
                      updateBuilderIngredient(index, 'quantity', Number(event.target.value) || 0)
                    }
                  />
                  <select
                    aria-label={`Ingredient unit ${index + 1}`}
                    value={ingredient.unit}
                    onChange={(event) => updateBuilderIngredient(index, 'unit', event.target.value)}
                  >
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Ingredient notes ${index + 1}`}
                    placeholder="Notes"
                    value={ingredient.notes ?? ''}
                    onChange={(event) => updateBuilderIngredient(index, 'notes', event.target.value)}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(ingredient.optional)}
                      onChange={(event) =>
                        updateBuilderIngredient(index, 'optional', event.target.checked)
                      }
                    />
                    Optional
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setBuilderRecipe((current) => ({
                        ...current,
                        ingredients: current.ingredients.filter(
                          (_currentIngredient, ingredientIndex) => ingredientIndex !== index,
                        ),
                      }))
                    }
                    disabled={builderRecipe.ingredients.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setBuilderRecipe((current) => ({
                    ...current,
                    ingredients: [...current.ingredients, defaultIngredient()],
                  }))
                }
              >
                Add ingredient
              </button>
            </div>

            <h3>Method steps</h3>
            <div className="builder-list">
              {builderRecipe.steps.map((step, index) => (
                <div className="builder-row" key={`builder-step-${index}`}>
                  <textarea
                    aria-label={`Step text ${index + 1}`}
                    placeholder={`Step ${index + 1}`}
                    value={step.text}
                    onChange={(event) => updateBuilderStep(index, 'text', event.target.value)}
                  />
                  <input
                    aria-label={`Step timer ${index + 1}`}
                    type="number"
                    min={0}
                    placeholder="Timer (min)"
                    value={step.timerMinutes ?? ''}
                    onChange={(event) => {
                      const numericValue = Number(event.target.value)
                      updateBuilderStep(
                        index,
                        'timerMinutes',
                        Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined,
                      )
                    }}
                  />
                  <input
                    aria-label={`Step notes ${index + 1}`}
                    placeholder="Notes"
                    value={step.notes ?? ''}
                    onChange={(event) => updateBuilderStep(index, 'notes', event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBuilderRecipe((current) => ({
                        ...current,
                        steps: current.steps.filter((_currentStep, stepIndex) => stepIndex !== index),
                      }))
                    }
                    disabled={builderRecipe.steps.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setBuilderRecipe((current) => ({
                    ...current,
                    steps: [...current.steps, defaultStep()],
                  }))
                }
              >
                Add step
              </button>
            </div>

            <div className="action-row">
              <button type="button" onClick={saveBuilderRecipe}>
                {editingRecipeId ? 'Update recipe' : 'Save recipe'}
              </button>
              <button type="button" onClick={resetBuilder}>
                Reset form
              </button>
            </div>
          </div>

          <aside className="panel">
            <h2>Saved recipes</h2>
            {customRecipes.length === 0 ? (
              <p className="empty-state">No custom recipes yet. Build one and save it locally.</p>
            ) : (
              <ul className="list-reset">
                {customRecipes.map((recipe) => (
                  <li key={recipe.id}>
                    <div>
                      <strong>{recipe.title}</strong>
                      <p>
                        {recipe.cuisine} • {recipe.cookTimeMinutes} min • serves {recipe.servings}
                      </p>
                    </div>
                    <div className="action-row">
                      <button type="button" onClick={() => editRecipe(recipe)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => downloadRecipeJson(recipe)}>
                        Export
                      </button>
                      <button type="button" onClick={() => handleCopyShareLink(recipe)}>
                        Share
                      </button>
                      <button type="button" onClick={() => removeRecipe(recipe.id)}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </section>
      )}
    </div>
  )
}

export default App
