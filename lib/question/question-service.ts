import type { QuestionPrompt } from "./types.ts"

let nextId = 0
function generateId(): string {
  nextId++
  return `q_${Date.now()}_${nextId}`
}

const QUESTION_TIMEOUT_MS = 300_000

interface PendingEntry {
  id: string
  questions: QuestionPrompt[]
  resolve: (answers: string[][]) => void
  reject: (err: Error) => void
  status: "pending" | "replied" | "rejected"
  createdAt: number
  timerHandle?: ReturnType<typeof setTimeout>
  onAbort?: () => void
  signal?: AbortSignal
}

const pending = new Map<string, PendingEntry>()

function cleanupEntry(id: string) {
  const entry = pending.get(id)
  if (!entry) return
  if (entry.timerHandle) clearTimeout(entry.timerHandle)
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener("abort", entry.onAbort)
  }
  pending.delete(id)
}

export const questionService = {
  ask(
    sessionPath: string,
    questions: QuestionPrompt[],
    emitEvent: (event: Record<string, unknown>, sp: string) => void,
    signal?: AbortSignal,
  ): Promise<string[][]> {
    const id = generateId()
    return new Promise<string[][]>((resolve, reject) => {
      const entry: PendingEntry = {
        id,
        questions,
        resolve,
        reject,
        status: "pending",
        createdAt: Date.now(),
      }
      entry.timerHandle = setTimeout(() => {
        if (entry.status === "pending") {
          cleanupEntry(id)
          reject(new Error("Question timed out"))
        }
      }, QUESTION_TIMEOUT_MS)
      if (signal) {
        entry.signal = signal
        entry.onAbort = () => {
          if (entry.status === "pending") {
            cleanupEntry(id)
            reject(new Error("Question aborted"))
          }
        }
        signal.addEventListener("abort", entry.onAbort, { once: true })
      }
      pending.set(id, entry)
      emitEvent({ type: "question", id, sessionPath, questions }, sessionPath)
    })
  },

  reply(id: string, answers: string[][]): boolean {
    const entry = pending.get(id)
    if (!entry) return false
    if (answers.length !== entry.questions.length) return false
    cleanupEntry(id)
    entry.resolve(answers)
    return true
  },

  reject(id: string): boolean {
    const entry = pending.get(id)
    if (!entry) return false
    cleanupEntry(id)
    entry.reject(new Error("User dismissed the question"))
    return true
  },

  list(): Array<{ id: string; questions: QuestionPrompt[]; status: string; createdAt: number }> {
    return Array.from(pending.values()).map((e) => ({
      id: e.id,
      questions: e.questions,
      status: e.status,
      createdAt: e.createdAt,
    }))
  },
}
