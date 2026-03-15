export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  nickname?: string;
  currentRoomId?: string;
}

export interface Room {
  id: string;
  name: string;
  createdBy: string;
  admins: string[];
  members: string[];
  inviteCode: string;
  createdAt: string;
}

export interface Task {
  id: string;
  roomId: string;
  title: string;
  assignedTo: string;
  status: 'pending' | 'completed';
  date: string;
  type: 'garbage' | 'water' | 'milk' | 'banana' | 'other';
}

export interface Activity {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: string;
  type: 'log' | 'chat';
}
