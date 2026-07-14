import { describe, expect, it } from 'vitest';
import type { TraceRun } from '../types';
import { runtimeStepsFromTrace } from './traceSteps';

const makeTrace = (result: Record<string, unknown>): TraceRun => ({
  id: 'trace-react',
  mode: 'react',
  modeName: 'ReAct',
  description: 'test trace',
  turnNumber: 1,
  userPrompt: '计算 128 * 64',
  finalAnswer: String(result.finalAnswer ?? ''),
  temperature: 0.7,
  model: 'deepseek-test',
  durationMs: 42,
  requestPayload: result,
  responsePayload: result,
  requestMessages: [],
  memoryMessages: [],
  conversationMessages: [],
  assistantMessage: {
    id: 'assistant',
    role: 'assistant',
    content: String(result.finalAnswer ?? ''),
    source: 'model_response',
  },
});

const response = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] });

describe('runtimeStepsFromTrace ReAct mapping', () => {
  it('shows a direct Final Answer through the shared runtime steps', () => {
    const result = {
      requestPayload: { messages: [{ role: 'user', content: '你好' }] },
      reactToolGuide: 'calculate(expression)',
      maxRounds: 4,
      finalAnswer: '你好！',
      reactSteps: [{
        round: 1,
        assistantContent: 'Final Answer: 你好！',
        parsed: { finalAnswer: '你好！' },
        requestPayload: { messages: [{ role: 'user', content: '你好' }] },
        responsePayload: response('Final Answer: 你好！'),
      }],
    };

    const steps = runtimeStepsFromTrace(makeTrace(result));

    expect(steps.map((step) => step.id)).toEqual([
      'goal',
      'react-assemble',
      'react-round-1-model',
      'react-round-1-provider',
      'react-round-1-parse',
      'final',
    ]);
    expect(steps.find((step) => step.id === 'react-round-1-parse')?.group).toBe('Round 1');
  });

  it('shows Action, tool execution, Observation, and the next real request', () => {
    const firstMessages = [{ role: 'user', content: '计算 128 * 64' }];
    const secondMessages = [
      ...firstMessages,
      { role: 'assistant', content: 'Thought: 需要计算\nAction: calculate\nAction Input: {"expression":"128*64"}' },
      { role: 'user', content: 'Observation: 8192' },
    ];
    const result = {
      requestPayload: { messages: firstMessages },
      reactToolGuide: 'calculate(expression)',
      maxRounds: 4,
      finalAnswer: '8192',
      reactSteps: [
        {
          round: 1,
          assistantContent: 'Thought: 需要计算\nAction: calculate\nAction Input: {"expression":"128*64"}',
          parsed: { thought: '需要计算', action: 'calculate', actionInput: { expression: '128*64' } },
          toolExecution: {
            toolCall: { id: 'react-1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"128*64"}' } },
            name: 'calculate',
            arguments: { expression: '128*64' },
            content: '8192',
            ok: true,
          },
          observationMessage: { role: 'user', content: 'Observation: 8192' },
          requestPayload: { messages: firstMessages },
          responsePayload: response('Action: calculate'),
        },
        {
          round: 2,
          assistantContent: 'Final Answer: 8192',
          parsed: { finalAnswer: '8192' },
          requestPayload: { messages: secondMessages },
          responsePayload: response('Final Answer: 8192'),
        },
      ],
    };

    const steps = runtimeStepsFromTrace(makeTrace(result));
    const ids = steps.map((step) => step.id);
    const observation = steps.find((step) => step.id === 'react-round-1-observation');

    expect(ids).toContain('react-round-1-tool');
    expect(ids).toContain('react-round-1-observation');
    expect(ids).toContain('react-round-2-parse');
    expect(observation?.stateChange?.[0].value).toEqual(secondMessages);
  });

  it('exposes maximum-round fallback as a separate runtime phase', () => {
    const finalRequestPayload = { messages: [{ role: 'user', content: 'Produce Final Answer' }] };
    const result = {
      requestPayload: { messages: [{ role: 'user', content: '复杂任务' }] },
      maxRounds: 1,
      finalAnswer: '尽力而为的答案',
      reactSteps: [],
      finalRequestPayload,
      finalResponsePayload: response('Final Answer: 尽力而为的答案'),
    };

    const ids = runtimeStepsFromTrace(makeTrace(result)).map((step) => step.id);

    expect(ids).toContain('react-round-limit');
    expect(ids).toContain('react-fallback-model');
    expect(ids).toContain('react-fallback-provider');
  });
});
