// Product copy (Chinese, per CONTRIBUTING.md). Kept in one place so wording
// and accessibility labels are reviewed together.
import type { HomeState, SignInProblem, VerificationStatus } from "./api/types";
import type { Tab } from "./shell/state";
import type { NotificationStatus } from "./platform/notifications";

export const APP_NAME = "不期";

export const TAB_LABELS: Readonly<Record<Tab, string>> = {
  ai: "AI",
  dates: "约会",
  relationships: "关系",
  me: "我",
};

export const SIGN_IN = {
  title: "欢迎来到不期",
  intro: "让 AI 处理筛选与安排，把第一次见面的未知留给你们。",
  phoneLabel: "手机号",
  phoneHint: "仅用于登录，不会展示给任何人。",
  codeLabel: "验证码",
  sendCode: "获取验证码",
  codeSent: "验证码已发送",
  sentTo: (masked: string) => `验证码已发送至 ${masked}`,
  resendIn: (seconds: number) => `${String(seconds)} 秒后可重新发送`,
  resend: "重新发送",
  changePhone: "更换手机号",
  phonePrefix: "+86",
  submit: "登录",
  mockNote: (code: string) => `演示版本：不连接服务器，验证码为 ${code}。`,
  adultsOnly: "仅限年满 18 周岁并完成实名核验的成年人使用。",
  problems: {
    invalid_phone: "请输入 11 位手机号。",
    invalid_code: "验证码不正确，请重新输入。",
    unavailable: "暂时无法登录，请稍后再试。",
  } satisfies Record<SignInProblem, string>,
};

export const PRIMER = {
  title: "在需要的时候提醒你",
  body: "我们只在这些时候通知你：收到约会邀请、约会前一天和当天的提醒、退款进度，以及安全相关的消息。",
  privacy: "锁屏通知不会显示对方信息、你的偏好或关系状态。",
  allow: "开启通知",
  later: "以后再说",
  laterNote: "你随时可以在“我”页面开启。",
};

export const AI_HEADLINES: Readonly<Record<HomeState, string>> = {
  new: "和 AI 认识一下",
  matching: "AI 正在为你寻找合适时间",
  booked: "你的下一场约会",
  in_relationship: "暂停匹配，保留记忆",
};

export const AI_PAGE = {
  intro: {
    new: "用十来分钟聊聊你的生活、期待和边界。可以随时打断、跳过或改用文字。",
    matching: "匹配在后台进行，有合适的约会会通知你。不会给你看候选人的照片或资料。",
    booked: "约会的时间、地点和你的金额在“约会”页。",
    in_relationship: "你已暂停匹配。想回来时，可以在“我”页面恢复。",
  } satisfies Record<HomeState, string>,
  startVoice: "开始语音对话",
  voiceSoon: "语音对话将在后续版本开放。",
  searching: "AI 在后台为你留意合适的时间与人",
  seeDate: "约会的时间与地点在“约会”页。",
};

export const DATES_PAGE = {
  empty: "好的相遇，值得一点等待。",
  emptyHint: "有合适的约会时，你会先收到一份邀请，可以接受，也可以拒绝。",
  yourDate: "你的约会",
  countdown: (days: number) =>
    days > 1
      ? `还有 ${String(days)} 天`
      : days === 1
        ? "明天见"
        : days === 0
          ? "就在今天"
          : "已结束",
  when: "时间",
  where: "地点",
  pkg: "套餐",
  yourShare: "你需支付",
  cancelRule: "取消规则",
  hidden: "见面前不会显示对方的照片、姓名或资料。",
  help: "需要帮助",
};

export const RELATIONSHIPS_PAGE = {
  empty: "故事，从见面之后开始。",
  emptyHint: "见面后，如果你们都愿意继续，对方会出现在这里。",
  metOn: (date: string) => `${date}见面`,
  chat: "聊天",
  block: "屏蔽或举报",
};

export const ME_PAGE = {
  account: "账号",
  matching: "匹配",
  verification: "实名与成年核验",
  verificationStatus: {
    not_started: "未开始",
    pending: "审核中",
    verified: "已通过",
  } satisfies Record<VerificationStatus, string>,
  notifications: "通知",
  notificationStatus: {
    undetermined: "未开启",
    granted: "已开启",
    denied: "已关闭，可在系统设置中开启",
    unavailable: "此设备不支持",
  } satisfies Record<NotificationStatus, string>,
  enableNotifications: "开启通知",
  openSettings: "打开系统设置",
  pauseMatching: "暂停匹配",
  pauseHint: "暂停后不会收到新的约会邀请，账号和资料都会保留。",
  privacy: "隐私与授权",
  privacySoon: "即将开放",
  signOut: "退出登录",
};

export const COMMON = {
  loading: "加载中…",
  loadFailed: "加载失败。",
  retry: "重试",
};
