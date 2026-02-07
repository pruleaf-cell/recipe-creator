import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const buildModelResponse = (title: string): string =>
  JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            assistantSummary: `Generated ${title}`,
            recipes: [
              {
                title,
                description: 'A dynamic recipe from tests.',
                cuisine: 'Test Kitchen',
                difficulty: 'Easy',
                cookTimeMinutes: 24,
                servings: 2,
                dietaryTags: ['vegetarian'],
                allergens: ['dairy'],
                equipment: ['hob'],
                ingredients: [
                  {
                    name: 'onion',
                    quantity: 1,
                    unit: 'whole',
                    optional: false,
                    notes: '',
                  },
                  {
                    name: 'olive oil',
                    quantity: 1,
                    unit: 'tbsp',
                    optional: false,
                    notes: '',
                  },
                ],
                steps: [
                  {
                    text: 'Chop the onion.',
                    timerMinutes: 2,
                    notes: '',
                    temperatureC: 0,
                    gasMark: '',
                  },
                  {
                    text: 'Saute until softened.',
                    timerMinutes: 8,
                    notes: '',
                    temperatureC: 0,
                    gasMark: '',
                  },
                ],
                swapSuggestions: ['Swap onion for shallot.'],
                tips: ['Warm plates before serving.'],
              },
            ],
          }),
        },
      },
    ],
  })

describe('App LLM interactions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('navigator', {
      ...window.navigator,
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('generates recipes from the LLM endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => buildModelResponse('Test LLM Pasta'),
    } as Response)

    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText(/^API key$/i), 'sk-test-key')
    await user.click(screen.getByRole('button', { name: /Generate Astonishing Recipes/i }))

    expect(await screen.findByText('Test LLM Pasta')).toBeInTheDocument()
    expect(screen.getAllByText(/Generated Test LLM Pasta/i).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refines the selected recipe with follow-up instruction', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => buildModelResponse('Original Recipe'),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => buildModelResponse('Refined Recipe'),
      } as Response)

    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText(/^API key$/i), 'sk-test-key')
    await user.click(screen.getByRole('button', { name: /Generate Astonishing Recipes/i }))
    expect(await screen.findByText('Original Recipe')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Instruction/i), 'Make it spicier and under 20 minutes.')
    await user.click(screen.getByRole('button', { name: /Refine Selected Recipe/i }))

    expect(await screen.findByText('Refined Recipe')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens cook mode from a generated recipe card', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => buildModelResponse('Cook Mode Recipe'),
    } as Response)

    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText(/^API key$/i), 'sk-test-key')
    await user.click(screen.getByRole('button', { name: /Generate Astonishing Recipes/i }))
    expect(await screen.findByText('Cook Mode Recipe')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Start Cook Mode/i }))

    expect(await screen.findByRole('dialog', { name: /Cook mode/i })).toBeInTheDocument()
  })
})
