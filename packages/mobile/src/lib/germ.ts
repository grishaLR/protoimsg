export const GERM_DECLARATION_NSID = 'com.germnetwork.declaration';

export interface GermMessageMe {
  showButtonTo: 'everyone' | 'usersIFollow' | 'none';
  messageMeUrl: string;
}

export interface GermDeclaration {
  $type: typeof GERM_DECLARATION_NSID;
  messageMe: GermMessageMe;
}

export function buildGermUrl(messageMeUrl: string, targetDid: string, viewerDid: string): string {
  const base = messageMeUrl.replace(/\/+$/, '');
  return `${base}/web#${targetDid}+${viewerDid}`;
}
