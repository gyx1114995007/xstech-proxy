export const XSTECH_RUNTIME_API = {
  auth: {
    login: {
      method: 'POST',
      path: '/api/user/login',
      status: 'confirmed-runtime'
    },
    userInfo: {
      method: 'GET',
      path: '/api/user/info',
      status: 'confirmed-runtime'
    }
  },
  chat: {
    tmpl: {
      method: 'GET',
      path: '/api/chat/tmpl',
      status: 'confirmed-runtime'
    },
    sessionList: {
      method: 'GET',
      path: '/api/chat/session?page=1',
      status: 'confirmed-runtime'
    },
    record: {
      method: 'GET',
      path: '/api/chat/record/:sessionId?page=1',
      status: 'confirmed-runtime'
    },
    completions: {
      method: 'POST',
      path: '/api/chat/completions',
      status: 'confirmed-runtime',
      requestBody: {
        status: 'not-fully-captured-yet',
        possibleFieldsFromBundle: [
          'sessionId',
          'model',
          'prompt',
          'contextCount',
          'maxToken',
          'temperature',
          'presencePenalty',
          'frequencyPenalty',
          'topSort',
          'useImages',
          'useFiles',
          'quote'
        ]
      },
      response: {
        status: 'not-fully-captured-yet',
        uiConfirmed: [
          'thinking/deep-thinking visible',
          'assistant message visible',
          'message attached to current session'
        ]
      }
    }
  },
  messageShape: {
    confirmedFromBundle: [
      'userText',
      'aiText',
      'replies',
      'useImages',
      'useFiles',
      'useTokens',
      'promptTokens',
      'contextTokens',
      'completionTokens',
      'userStop',
      'model',
      'sessionId',
      'logs',
      'regeneratingContent',
      'audio',
      'modelLabel',
      'modelIcon'
    ]
  },
  sessionShape: {
    confirmedFromBundle: [
      'uid',
      'name',
      'useAppId',
      'icon',
      'model',
      'maxToken',
      'prompt',
      'contextCount',
      'temperature',
      'presencePenalty',
      'frequencyPenalty',
      'topSort'
    ]
  },
  modelCapabilities: {
    confirmedFromBundle: [
      'imageInput',
      'anyFile',
      'tools',
      'stream',
      'systemRole',
      'useMaxCompletionTokens',
      'forceMaxTokens',
      'useResponsesApi',
      'thinking',
      'autoDetectThinking'
    ]
  }
};

export default XSTECH_RUNTIME_API;
