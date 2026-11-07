import React from 'react';
import { ActivityBadge, ActivityBadgeProps } from './ActivityBadge';

export const SyncStatusBadge: React.FC<ActivityBadgeProps> = (props) => {
  return <ActivityBadge {...props} />;
};
