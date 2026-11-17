export type UserRole = 
  | 'GENERAL_SECRETARY' 
  | 'ASSISTANT_SECRETARY' 
  | 'PASTOR' 
  | 'DEPARTMENT_LEADER' 
  | 'PLATFORM_ADMIN' 
  | 'PLATFORM_ASSISTANT_ADMIN'
  | 'ADMIN'
  | 'SECRETARY'
  | 'TREASURER'
  | 'MEMBER';

export type PlatformPermission =
  | 'MANAGE_CHURCHES'       // Gerenciamento de igrejas
  | 'MANAGE_FINANCES'       // Administração financeira
  | 'SUPPORT'               // Suporte
  | 'PLATFORM_SETTINGS'     // Configurações da plataforma
  | 'TECHNICAL_MONITORING'  // Monitoramento técnico
  | 'SUBSCRIPTIONS'         // Assinaturas e primeira igreja gratuita
  | 'CLOSE_CHURCHES';       // Encerramento de igrejas

export type ChurchStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type AutoBackupFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'DISABLED';
export type BackupExportFormat = 'JSON' | 'CSV' | 'BOTH';

export interface Church {
  id: string;
  name: string;
  denomination: string;
  cnpj?: string;
  pastorName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  exclusiveCode: string;
  status: ChurchStatus;
  plan: 'FREE_PERMANENT' | 'MONTHLY_50' | 'ANNUAL_600' | 'FREE';
  planStatus: 'ACTIVE' | 'TRIAL' | 'IN_GRACE_PERIOD' | 'SUSPENDED_OVERDUE' | 'SUSPENDED';
  dueDate?: string;
  gracePeriodStartDate?: string;
  permanentFreeTierGrantedAt?: string;
  permanentFreeTierGrantedBy?: string;
  closureRequested?: boolean;
  closureRequestedAt?: string;
  closureReason?: string;
  closureLegalRetentionVerified?: boolean;
  ownerUid?: string;
  createdAt: string;
  offlineConfig?: {
    maxOfflineDays: number;
    autoBackupDaily: boolean;
    autoBackupFrequency?: AutoBackupFrequency;
    autoBackupFormat?: BackupExportFormat;
    autoDownloadLocalBackup?: boolean;
    lastAutoBackupAt?: string;
  };
}

export interface User {
  id: string;
  churchId: string;
  name: string;
  email: string;
  role: UserRole;
  platformPermissions?: PlatformPermission[];
  departmentIds?: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_INVITE';
  claimedFromUserId?: string;
  lastLogin?: string;
  notificationPreferences?: {
    inApp: boolean;
    push: boolean;
    email: boolean;
  };
}

export interface Member {
  id: string;
  churchId: string;
  fullName: string;
  memberCode: string;
  birthDate?: string;
  gender?: 'MALE' | 'FEMALE';
  maritalStatus?: 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'DIVORCED';
  spouse?: string;
  motherName?: string;
  fatherName?: string;
  birthplace?: string;
  nationality?: string;
  profession?: string;
  educationLevel?: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  phone: string;
  email: string;
  membershipDate: string;
  baptismDate?: string;
  churchRole?: string;
  departmentIds: string[];
  photoUrl?: string;
  notes?: string;
  status: 'ACTIVE' | 'INACTIVE';
  deactivationReason?: string;
  history?: {
    date: string;
    action: string;
    author: string;
  }[];
  updatedAt?: string;
}

export interface Department {
  id: string;
  churchId: string;
  name: string;
  description: string;
  leaderId: string;
  leaderName: string;
  memberCount: number;
  meetingDay?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt?: string;
}

export interface DepartmentTransferHistory {
  id: string;
  churchId: string;
  memberId: string;
  memberName: string;
  fromDepartmentId?: string;
  fromDepartmentName?: string;
  toDepartmentId: string;
  toDepartmentName: string;
  date: string;
  author: string;
  type: 'ADD' | 'TRANSFER' | 'REMOVE';
}

export interface ChurchEvent {
  id: string;
  churchId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  category: 'CULT' | 'REUNION' | 'BAPTISM' | 'SPECIAL' | 'DEPARTMENT' | 'ADMIN';
  organizer: string;
  departmentId?: string;
  reminderMinutesBefore?: number;
  status?: 'SCHEDULED' | 'CANCELLED' | 'UPDATED';
  updatedAt?: string;
}

export interface AppNotification {
  id: string;
  churchId: string;
  userId: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'EVENT' | 'REMINDER' | 'SYSTEM';
}

export interface SystemReport {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  totalDepartments: number;
  totalEventsThisMonth: number;
  baptismsThisYear: number;
}

export interface AuditLog {
  id: string;
  churchId: string;
  userId: string;
  userName: string;
  action: string;
  entityType?: 'MEMBER' | 'DEPARTMENT' | 'USER' | 'EVENT' | 'SECURITY' | 'BACKUP' | 'EXPORT' | 'SETTINGS' | 'AUTH' | 'PLATFORM' | 'SUPPORT';
  entityId?: string;
  details: string;
  timestamp: number;
  date: string;
  syncedToFirestore?: boolean;
}

export interface SyncQueueItem {
  id: string;
  churchId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'MEMBER' | 'DEPARTMENT' | 'USER' | 'EVENT' | 'SETTINGS' | 'AUDIT_LOG' | 'TICKET' | 'PAYMENT' | 'BACKUP';
  entityId: string;
  payload: any;
  timestamp: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  retryCount: number;
  error?: string;
}

export interface SyncConflict {
  id: string;
  churchId: string;
  entity: 'MEMBER' | 'DEPARTMENT' | 'EVENT' | 'USER';
  entityId: string;
  entityName: string;
  localVersion: any;
  remoteVersion: any;
  detectedAt: string;
  status: 'PENDING' | 'RESOLVED';
  resolution?: 'KEPT_LOCAL' | 'KEPT_REMOTE' | 'MERGED';
}

export interface BackupRecord {
  id: string;
  churchId: string;
  churchName: string;
  createdAt: string;
  createdAtIso?: string;
  createdBy: string;
  recordCounts: {
    members: number;
    departments: number;
    events: number;
    users: number;
    auditLogs?: number;
  };
  checksum: string;
  dataJson: string;
  status: 'COMPLETED' | 'PRE_RESTORE' | 'FAILED';
  trigger?: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
  sizeBytes: number;
  integrityVerified: boolean;
}

export interface OfflineSessionState {
  lastOnlineAuth: number; // timestamp in ms
  maxOfflineDays: number; // e.g. 7
  isExpired: boolean;
}

export interface PaymentProof {
  id: string;
  churchId: string;
  churchName: string;
  plan: 'MONTHLY_50' | 'ANNUAL_600';
  amount: number;
  paymentMethod: 'PIX' | 'TRANSFER' | 'OTHER';
  proofUrl?: string; // or base64 data preview
  proofFileName?: string;
  receiptNumber?: string;
  notes?: string;
  submittedAt: string;
  submittedBy: string; // User name / email
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

export interface PlatformPaymentSettings {
  pixKey: string;
  pixKeyType: 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM';
  recipientName: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  instructions: string;
}

export type TicketCategory = 'DUVIDA' | 'TECNICO' | 'FINANCEIRO' | 'SUGESTAO' | 'OUTRO';
export type TicketPriority = 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_RESPONSE' | 'RESOLVED' | 'CANCELLED';

export interface TicketAttachment {
  name: string;
  url: string;
  type: string;
  size: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  isStaff: boolean;
  content: string;
  createdAt: string;
  attachments?: TicketAttachment[];
}

export interface SupportTicket {
  id: string;
  churchId: string;
  churchName: string;
  subject: string;
  category: TicketCategory;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  createdBy: string;
  createdById: string;
  updatedAt: string;
  attachments?: TicketAttachment[];
  assignedAdminName?: string;
  messages: TicketMessage[];
}
