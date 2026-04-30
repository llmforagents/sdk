import type { HttpTransport } from '../transport/http.js';

export interface AgentRegistrationParams {
  readonly name: string;
}

export interface AgentRegistration {
  readonly uuid: string;
  readonly apiKey: string;
  readonly name: string;
  readonly createdAt: string;
  readonly requestId: string;
  readonly depositDeadline: string;
  readonly depositRequiredWithinMinutes: number;
  readonly notice: string;
}

export class Agents {
  constructor(private readonly http: HttpTransport) {}

  async register(params: AgentRegistrationParams): Promise<AgentRegistration> {
    return this.http.post<AgentRegistration>('/api/v1/agents/register', { name: params.name });
  }
}
