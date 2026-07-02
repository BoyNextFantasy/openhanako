export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionPrompt {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
}

export interface QuestionState {
  id: string
  questions: QuestionPrompt[]
  sessionPath: string
  status: "pending" | "replied" | "rejected"
  createdAt: number
}

export interface QuestionAnswerEvent {
  type: "question"
  id: string
  sessionPath: string
  questions: QuestionPrompt[]
}

export interface QuestionReplyEvent {
  type: "question_reply"
  id: string
  sessionPath: string
  answers: string[][]
}
