import type { Locale } from '@/lib/i18n/locales';

/**
 * 이용약관·개인정보 처리방침 초안. 정식 공개 전 법률 검토를 거쳐 [대괄호] 자리(운영사·연락처·시행일)를 채워야 한다.
 * 실제 서비스가 하는 일(수집 항목·쿠키·삭제 방식)과 어긋나지 않게, 기능을 바꿀 때 이 문서도 함께 고친다.
 */
export interface LegalDoc {
  title: string;
  effective: string;
  sections: { heading: string; body: string[] }[];
}

const TERMS: Record<Locale, LegalDoc> = {
  ko: {
    title: 'Limenote 이용약관',
    effective: '시행일: [시행일]',
    sections: [
      {
        heading: '1. 목적',
        body: ['이 약관은 [운영사명](이하 "회사")이 제공하는 재고 분석 서비스 Limenote(이하 "서비스")의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.'],
      },
      {
        heading: '2. 계정과 워크스페이스',
        body: [
          '이용자는 워크스페이스를 만들거나 관리자의 초대를 받아 가입합니다. 한 이메일 주소는 하나의 계정에만 쓸 수 있습니다.',
          '워크스페이스 관리자는 구성원 초대·권한 변경·삭제와 워크스페이스 설정을 관리하며, 워크스페이스 안의 데이터에 대한 책임을 집니다.',
          '이용자는 비밀번호를 안전하게 관리해야 하며, 계정이 무단으로 쓰였다고 의심되면 즉시 비밀번호를 바꾸고 회사에 알려야 합니다.',
        ],
      },
      {
        heading: '3. 이용자 데이터',
        body: [
          '이용자가 올린 재고 파일·실사 수량·매출 기록 등(이하 "이용자 데이터")의 권리는 이용자에게 있습니다. 회사는 서비스 제공(분석·표시·백업)에 필요한 범위에서만 이용자 데이터를 처리합니다.',
          '서비스가 보여주는 소진 예상일·권장 발주량 등은 올린 자료를 바탕으로 한 추정이며, 실제 재고·판매와 다를 수 있습니다. 발주 등 최종 판단은 이용자가 합니다.',
        ],
      },
      {
        heading: '4. 금지 행위',
        body: ['타인의 계정 사용, 서비스에 대한 무단 접근·과도한 자동 요청, 법령을 위반하는 자료의 업로드, 서비스의 정상 운영을 방해하는 행위를 해서는 안 됩니다.'],
      },
      {
        heading: '5. 서비스 변경·중단',
        body: ['회사는 서비스 개선을 위해 기능을 바꿀 수 있으며, 이용에 큰 영향을 주는 변경은 미리 알립니다. 설비 점검·장애 등 불가피한 경우 서비스가 일시 중단될 수 있습니다.'],
      },
      {
        heading: '6. 이용 제한과 해지',
        body: [
          '약관을 위반하면 회사는 이용을 제한하거나 워크스페이스를 정지할 수 있습니다.',
          '워크스페이스 관리자는 설정에서 언제든 워크스페이스를 삭제(해지)할 수 있으며, 삭제하면 그 안의 이용자 데이터와 구성원 계정이 지체 없이 지워집니다.',
        ],
      },
      {
        heading: '7. 책임의 한계',
        body: ['회사는 고의 또는 중대한 과실이 없는 한, 추정 결과를 근거로 한 이용자의 판단이나 이용자가 올린 자료의 오류로 생긴 손해에 대해 책임지지 않습니다.'],
      },
      { heading: '8. 요금', body: ['현재 서비스는 무료로 제공됩니다. 유료 요금제를 도입하면 적용 전에 요금과 조건을 알립니다.'] },
      { heading: '9. 문의', body: ['[운영사명] · [연락처 이메일]'] },
    ],
  },
  en: {
    title: 'Limenote Terms of Service',
    effective: 'Effective date: [date]',
    sections: [
      { heading: '1. Purpose', body: ['These terms govern your use of Limenote (the "Service"), an inventory analysis service provided by [Company] ("we").'] },
      {
        heading: '2. Accounts and workspaces',
        body: [
          'You join by creating a workspace or by accepting an invitation from a workspace admin. Each email address can belong to one account.',
          'Workspace admins manage members, roles and settings, and are responsible for the data in their workspace.',
          'Keep your password safe. If you suspect unauthorized use, change your password and tell us right away.',
        ],
      },
      {
        heading: '3. Your data',
        body: [
          'You own the stock files, counts and sales records you upload ("Your Data"). We process Your Data only as needed to provide the Service (analysis, display, backups).',
          'Stock-out dates, suggested orders and other outputs are estimates based on your data and may differ from reality. You make the final decisions.',
        ],
      },
      {
        heading: '4. Prohibited use',
        body: [
          'Do not use other people’s accounts, access the Service without authorization or with excessive automated requests, upload unlawful material, or disrupt the Service.',
        ],
      },
      {
        heading: '5. Changes and interruptions',
        body: ['We may change features to improve the Service and will announce changes that materially affect you in advance. The Service may pause for maintenance or outages.'],
      },
      {
        heading: '6. Suspension and termination',
        body: [
          'We may restrict use or suspend a workspace that violates these terms.',
          'Workspace admins can delete (terminate) their workspace at any time in Settings. Deletion promptly removes the workspace data and member accounts.',
        ],
      },
      {
        heading: '7. Limitation of liability',
        body: ['Except for our intent or gross negligence, we are not liable for decisions made on the basis of estimates or for losses caused by errors in data you upload.'],
      },
      { heading: '8. Fees', body: ['The Service is currently free. We will announce prices and conditions before introducing any paid plan.'] },
      { heading: '9. Contact', body: ['[Company] · [contact email]'] },
    ],
  },
};

const PRIVACY: Record<Locale, LegalDoc> = {
  ko: {
    title: 'Limenote 개인정보 처리방침',
    effective: '시행일: [시행일]',
    sections: [
      {
        heading: '1. 수집하는 개인정보',
        body: [
          '가입·초대 수락 시: 이름, 이메일 주소, 비밀번호(복원할 수 없는 해시로만 저장), 약관 동의 시각.',
          '이용 중 자동 생성: 마지막 로그인 시각, 업로드·수정 기록(누가 언제 올렸는지), 서비스 운영자의 관리 조치 기록.',
          '재고 파일 등 이용자 데이터에는 원칙적으로 개인정보가 없어야 합니다. 개인정보가 담긴 파일은 올리지 마세요.',
        ],
      },
      {
        heading: '2. 이용 목적',
        body: ['계정 확인과 로그인, 이메일 인증·비밀번호 재설정·초대 메일 발송, 서비스 제공과 오류 대응, 부정 이용 방지(요청 횟수 제한 등).'],
      },
      {
        heading: '3. 보관 기간과 파기',
        body: [
          '계정 정보는 계정 삭제 또는 워크스페이스 삭제 시 지체 없이 파기합니다. 업로드·수정 기록이 남아 있는 계정은 기록을 보존하기 위해 계정 행만 남기고 이름·이메일·비밀번호는 즉시 지우며(기록에는 ‘삭제된 사용자’로 표시), 워크스페이스 삭제 시 함께 파기합니다.',
          '인증·재설정 링크는 각각 48시간·1시간 뒤 쓸 수 없게 되며, 초대 링크는 7일 뒤 만료됩니다.',
        ],
      },
      {
        heading: '4. 처리 위탁',
        body: ['서비스 운영을 위해 서버 호스팅([호스팅 업체])과 메일 발송([메일 발송 업체])을 위탁할 수 있습니다. 위탁 업체가 바뀌면 이 방침을 고쳐 알립니다.'],
      },
      {
        heading: '5. 쿠키',
        body: ['로그인 유지(세션), 화면 언어, 마지막으로 본 대시보드를 기억하는 쿠키만 씁니다. 광고·추적 쿠키는 쓰지 않습니다.'],
      },
      {
        heading: '6. 이용자의 권리',
        body: ['설정에서 자신의 정보를 확인하고 직접 탈퇴할 수 있으며, 관리자는 워크스페이스를 직접 삭제할 수 있습니다. 그 밖의 열람·정정·삭제 요청은 아래로 연락해 주세요.'],
      },
      { heading: '7. 개인정보 보호책임자', body: ['[이름] · [연락처 이메일]'] },
    ],
  },
  en: {
    title: 'Limenote Privacy Policy',
    effective: 'Effective date: [date]',
    sections: [
      {
        heading: '1. What we collect',
        body: [
          'When you sign up or accept an invitation: name, email address, password (stored only as a one-way hash), and when you accepted the terms.',
          'While you use the Service: last sign-in time, upload and edit history (who changed what and when), and records of operator actions.',
          'Stock files and other data you upload should not contain personal information. Please do not upload files that do.',
        ],
      },
      {
        heading: '2. Why we use it',
        body: [
          'To identify you and sign you in, to send verification, password-reset and invitation emails, to provide and troubleshoot the Service, and to prevent abuse (e.g. rate limiting).',
        ],
      },
      {
        heading: '3. Retention and deletion',
        body: [
          'Account information is deleted promptly when the account or the workspace is deleted. Accounts referenced by upload or edit history keep an anonymous record (shown as a deleted user) while the name, email and password are erased immediately; the record is removed together with the workspace.',
          'Verification and reset links stop working after 48 hours and 1 hour respectively; invitation links expire after 7 days.',
        ],
      },
      {
        heading: '4. Processors',
        body: ['We may use processors for server hosting ([hosting provider]) and email delivery ([email provider]). We will update this policy if they change.'],
      },
      {
        heading: '5. Cookies',
        body: ['We use cookies only to keep you signed in and to remember your language and last dashboard. We do not use advertising or tracking cookies.'],
      },
      {
        heading: '6. Your rights',
        body: [
          'You can see your information and delete your own account in Settings, and admins can delete the whole workspace. For other access, correction or deletion requests, contact us below.',
        ],
      },
      { heading: '7. Privacy contact', body: ['[Name] · [contact email]'] },
    ],
  },
};

export const LEGAL = { terms: TERMS, privacy: PRIVACY };
