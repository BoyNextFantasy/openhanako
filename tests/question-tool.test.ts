import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Value } from "typebox/value"
import { loadLocale } from "../lib/i18n.ts"
import { createQuestionTool } from "../lib/tools/question-tool.ts"
import { questionService } from "../lib/question/question-service.ts"
import type { QuestionPrompt } from "../lib/question/types.ts"

beforeEach(() => {
  loadLocale("en")
})

afterEach(() => {
  for (const entry of questionService.list()) {
    questionService.reject(entry.id)
  }
})

describe("questionService", () => {
  it("ask registers a pending entry and returns a promise", async () => {
    const promise = questionService.ask("s1", [
      { question: "Pick one", header: "Pick", options: [{ label: "A", description: "A desc" }] },
    ], vi.fn())

    const list = questionService.list()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe("pending")

    questionService.reply(list[0].id, [["A"]])
    await expect(promise).resolves.toEqual([["A"]])
  })

  it("reply resolves multiple questions", async () => {
    const questions: QuestionPrompt[] = [
      { question: "Q1?", header: "Q1", options: [{ label: "X", description: "X" }] },
      { question: "Q2?", header: "Q2", options: [{ label: "Y", description: "Y" }] },
    ]
    const promise = questionService.ask("s1", questions, vi.fn())
    const id = questionService.list()[0].id

    questionService.reply(id, [["X"], ["Y"]])
    await expect(promise).resolves.toEqual([["X"], ["Y"]])
  })

  it("reject rejects the promise", async () => {
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn())
    const id = questionService.list()[0].id

    questionService.reject(id)
    await expect(promise).rejects.toThrow("User dismissed the question")
  })

  it("reply with invalid id returns false", () => {
    expect(questionService.reply("nonexistent", [["A"]])).toBe(false)
  })

  it("reject with invalid id returns false", () => {
    expect(questionService.reject("nonexistent")).toBe(false)
  })

  it("list returns pending entries and removes them after reply", async () => {
    const p1 = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn())
    const id1 = questionService.list()[0].id

    expect(questionService.list()).toHaveLength(1)

    questionService.reply(id1, [["A"]])
    await p1

    expect(questionService.list()).toHaveLength(0)
  })

  it("emitEvent is called with the question event", async () => {
    const emit = vi.fn()
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], emit)
    const id = questionService.list()[0].id

    expect(emit).toHaveBeenCalledTimes(1)
    const [event] = emit.mock.calls[0]
    expect(event.type).toBe("question")
    expect(event.id).toBeDefined()
    expect(event.sessionPath).toBe("s1")
    expect(event.questions).toHaveLength(1)

    questionService.reply(id, [["A"]])
    await promise.catch(() => {})
  })
})

describe("questionService with AbortSignal", () => {
  it("signal already aborted does not reject immediately (future abort only)", async () => {
    const ac = new AbortController()
    ac.abort()
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn(), ac.signal)
    expect(questionService.list()).toHaveLength(1)
    questionService.reject(questionService.list()[0].id)
    await expect(promise).rejects.toThrow("User dismissed the question")
  })

  it("rejects when signal fires abort while pending", async () => {
    const ac = new AbortController()
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn(), ac.signal)
    expect(questionService.list()).toHaveLength(1)
    ac.abort()
    await expect(promise).rejects.toThrow("Question aborted")
    expect(questionService.list()).toHaveLength(0)
  })

  it("reply wins over abort signal", async () => {
    const ac = new AbortController()
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn(), ac.signal)
    const id = questionService.list()[0].id
    const ok = questionService.reply(id, [["A"]])
    expect(ok).toBe(true)
    ac.abort()
    await expect(promise).resolves.toEqual([["A"]])
    expect(questionService.list()).toHaveLength(0)
  })

  it("rejects with signal when reply has wrong answer count", async () => {
    const ac = new AbortController()
    const promise = questionService.ask("s1", [
      { question: "Q1?", header: "Q1", options: [{ label: "A", description: "A" }] },
      { question: "Q2?", header: "Q2", options: [{ label: "B", description: "B" }] },
    ], vi.fn(), ac.signal)
    const id = questionService.list()[0].id
    const ok = questionService.reply(id, [["A"]])
    expect(ok).toBe(false)
    ac.abort()
    await expect(promise).rejects.toThrow("Question aborted")
    expect(questionService.list()).toHaveLength(0)
  })

  it("signal is optional and backward compatible", async () => {
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn())
    const id = questionService.list()[0].id
    questionService.reply(id, [["A"]])
    await expect(promise).resolves.toEqual([["A"]])
  })
})

describe("createQuestionTool", () => {
  it("has name 'question'", () => {
    const tool = createQuestionTool()
    expect(tool.name).toBe("question")
  })

  it("has a description", () => {
    const tool = createQuestionTool()
    expect(tool.description).toBeTruthy()
    expect(tool.description).toContain("ask")
  })

  it("schema accepts an empty questions array", () => {
    const tool = createQuestionTool()
    expect(Value.Check(tool.parameters, { questions: [] })).toBe(true)
  })

  it("schema accepts valid input", () => {
    const tool = createQuestionTool()
    const valid = {
      questions: [
        {
          question: "What color?",
          header: "Color",
          options: [{ label: "Red", description: "Red color" }],
        },
      ],
    }
    expect(Value.Check(tool.parameters, valid)).toBe(true)
  })

  it("schema rejects missing question field", () => {
    const tool = createQuestionTool()
    const invalid = {
      questions: [{ header: "H", options: [{ label: "A", description: "D" }] }],
    }
    expect(Value.Check(tool.parameters, invalid)).toBe(false)
  })

  it("schema supports optional multiple flag", () => {
    const tool = createQuestionTool()
    const withMultiple = {
      questions: [
        {
          question: "Pick?",
          header: "Pick",
          options: [{ label: "A", description: "A" }, { label: "B", description: "B" }],
          multiple: true,
        },
      ],
    }
    expect(Value.Check(tool.parameters, withMultiple)).toBe(true)
  })

  it("execute + reply returns formatted result", async () => {
    const tool = createQuestionTool()
    let capturedId: string
    const mockCtx = {
      sessionPath: "test-session",
      emitEvent: (event: any) => { capturedId = event.id },
    }

    const params = {
      questions: [
        { question: "What color?", header: "Color", options: [{ label: "Red", description: "Red color" }] },
      ],
    }

    const resultPromise = tool.execute("tc-1", params, null, null, mockCtx)
    const ok = questionService.reply(capturedId!, [["Red"]])
    expect(ok).toBe(true)

    const result = await resultPromise
    expect(result.content[0].text).toContain("What color?")
    expect(result.content[0].text).toContain("Red")
    expect(result.details.answers).toEqual([["Red"]])
  })

  it("questionService.reply rejects on mismatched answers length", async () => {
    const promise = questionService.ask("s1", [
      { question: "Q1?", header: "Q1", options: [{ label: "A", description: "A" }] },
      { question: "Q2?", header: "Q2", options: [{ label: "B", description: "B" }] },
    ], vi.fn())
    const id = questionService.list()[0].id

    const ok = questionService.reply(id, [["A"]])
    expect(ok).toBe(false)
    expect(questionService.list()[0].status).toBe("pending")

    questionService.reject(id)
    await promise.catch(() => {})
  })

  it("questionService.reject returns false for already-dismissed entry", async () => {
    const promise = questionService.ask("s1", [
      { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
    ], vi.fn())
    const id = questionService.list()[0].id

    questionService.reject(id)
    await promise.catch(() => {})

    expect(questionService.reject(id)).toBe(false)
  })

  it("execute + reject throws", async () => {
    const tool = createQuestionTool()
    let capturedId: string
    const mockCtx = {
      sessionPath: "test-session",
      emitEvent: (event: any) => { capturedId = event.id },
    }

    const params = {
      questions: [
        { question: "Q?", header: "Q", options: [{ label: "A", description: "A" }] },
      ],
    }

    const resultPromise = tool.execute("tc-2", params, null, null, mockCtx)
    questionService.reject(capturedId!)
    await expect(resultPromise).rejects.toThrow("User dismissed the question")
  })
})
