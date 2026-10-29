// Tiny message table for the web UI: a plain object per language, `{name}` placeholders.
// Add a key to BOTH tables (test/i18n.test.ts checks that). Server/CLI messages stay English.

const en = {
  'diff.prev': 'vs previous',
  'diff.baseline': 'vs baseline',
  'layout.unified': 'unified',
  'layout.split': 'split',
  'kind.baseline': 'baseline',
  'kind.step': 'step',
  'kind.end': 'end',
  'step.files': '{n} file(s)',
  'tabs.all': 'All ({n})',
  'diff.baselineEmpty': 'Step 0 is the baseline: the state you marked with "{name} start". Pick a later step.',
  'diff.noChanges': 'No file changes in this view.',
  'why.prompt': 'Prompt: ',
  'why.agent': 'Agent said: ',
  'explain.heading': 'Explanation',
  'explain.baselineHint': 'Baseline: nothing to explain.',
  'explain.noChanges': 'No file changes in this step.',
  'explain.noProvider': 'No explanation provider is set, so nothing is generated and nothing leaves your machine.\n\nTo enable explanations run:\n  git config {name}.provider claude\nthen reload.',
  'explain.reveal': 'Reveal explanation',
  'explain.loading': 'Loading…',
  'explain.busy': 'Explaining…',
  'explain.retry': 'Failed, retry',
  'explain.button': 'Explain this step',
  'explain.sends': '\nSends this step\'s diff to your "{provider}" CLI.',
  'part.requested': 'Requested',
  'part.done': 'Done',
  'part.gap': 'Gap',
  'part.check': 'Check yourself',
  'part.concepts': 'Concepts',
  'part.jump': 'Show {path} in the diff',
  'empty.title': 'No sessions in this repository yet',
  'empty.body': 'Mark a baseline, let your agent (or you) edit files, then snapshot a step:',
  'error.prefix': 'Error: {message}',
};

const ko: Record<keyof typeof en, string> = {
  'diff.prev': '직전과 비교',
  'diff.baseline': '기점과 비교',
  'layout.unified': '통합',
  'layout.split': '나란히',
  'kind.baseline': '기점',
  'kind.step': '단계',
  'kind.end': '종료',
  'step.files': '파일 {n}개',
  'tabs.all': '전체 ({n})',
  'diff.baselineEmpty': '0단계는 기점입니다: "{name} start" 로 표시해 둔 상태예요. 이후 단계를 고르세요.',
  'diff.noChanges': '이 보기에는 파일 변경이 없습니다.',
  'why.prompt': '프롬프트: ',
  'why.agent': '에이전트 응답: ',
  'explain.heading': '해설',
  'explain.baselineHint': '기점: 해설할 변경이 없습니다.',
  'explain.noChanges': '이 단계에는 파일 변경이 없습니다.',
  'explain.noProvider': '해설 제공자가 설정되지 않아 아무것도 생성하지 않으며, 내 컴퓨터 밖으로 나가는 것도 없습니다.\n\n해설을 켜려면 다음을 실행하세요:\n  git config {name}.provider claude\n그리고 새로고침하세요.',
  'explain.reveal': '해설 보기',
  'explain.loading': '불러오는 중…',
  'explain.busy': '해설 생성 중…',
  'explain.retry': '실패, 다시 시도',
  'explain.button': '이 단계 해설하기',
  'explain.sends': '\n이 단계의 diff 를 "{provider}" CLI 로 보냅니다.',
  'part.requested': '요청한 것',
  'part.done': '실제로 한 것',
  'part.gap': '차이',
  'part.check': '직접 확인할 곳',
  'part.concepts': '쓰인 개념',
  'part.jump': 'diff 에서 {path} 보기',
  'empty.title': '이 저장소에는 아직 세션이 없습니다',
  'empty.body': '기점을 표시하고, 에이전트(또는 직접)가 파일을 고친 뒤, 단계를 스냅샷하세요:',
  'error.prefix': '오류: {message}',
};

export type MessageKey = keyof typeof en;
export const MESSAGES: Record<'en' | 'ko', Record<MessageKey, string>> = { en, ko };

/** Unknown or missing language falls back to English. */
export function pickLang(lang: string | undefined): 'en' | 'ko' {
  return lang === 'ko' ? 'ko' : 'en';
}

export function translate(lang: string | undefined, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return MESSAGES[pickLang(lang)][key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
