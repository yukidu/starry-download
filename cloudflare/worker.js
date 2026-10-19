import {Container} from '@cloudflare/containers';
import {digest, handleRequest} from './access.js';
import {handleCentralSso} from './central-sso.js';
import {shouldCheckDownloadAccess, isDownloadPageRequest, resolveDownloadAccess, accessDeniedResponse, downloadAccessStatusResponse} from './download-access-gate.js';
import {handleDownloadHistoryRequest, recordDownloadStart} from './history.js';
import {handlePushRequest, notifyReportCreated, saveReportPushState} from './push.js';
import {enforceMemberReport, handleReportRepairRequest} from './report-repair.js';
import {authenticatedDownloadStarryMember, handleFavoritesRequest} from './favorites.js';
import {isSuperAdminRequest} from './super-admin.js';
import {handleAdminReportList} from './admin-reports.js';

export class VideoDownloader extends Container {
  defaultPort = 8080;
  sleepAfter = '2m';
  enableInternet = true;

  async fetch(request) {
    this.envVars = {
      APP_MODE: 'cloud',
      YUANBAO_COOKIE: this.env.YUANBAO_COOKIE || '',
      CLOUD_BACKEND_TOKEN: await digest(`backend:${this.env.AUTH_PASSWORD}`),
      MAX_ACTIVE_JOBS: '1',
      MAX_DOWNLOAD_BYTES: '536870912',
      JOB_TTL_SECONDS: '900',
    };
    return super.fetch(request);
  }
}

async function enhanceProductionPage(response) {
  const type = response.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('text/html')) return response;

  let html = await response.text();
  html = html.replaceAll('繁星下載', '繁星捕手').replaceAll('Starry ID', '繁星通行證');
  // Install the lazy gesture gate BEFORE the old site scripts. Anonymous
  // visitors see the actual landing page, but interactions are checked once.
  if (!html.includes('/static/starry-account-switch.js')) {
    html = html.replace('</body>', '<script src="/static/starry-account-switch.js"></script><script src="/static/access-gate.js"></script></body>');
  }
  if (!html.includes('/static/brand-sync.js')) {
    html = html.replace('</body>', '<script src="/static/brand-sync.js"></script><script src="/static/ecosystem-sso.js"></script></body>');
  } else if (!html.includes('/static/ecosystem-sso.js')) {
    html = html.replace('</body>', '<script src="/static/ecosystem-sso.js"></script></body>');
  }

  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchHandler(request, env, ctx) {
  try {
    const centralSsoResponse = await handleCentralSso(request, env);
    if (centralSsoResponse) return centralSsoResponse;
  } catch {
    return Response.json({error: '繁星通行證中央登入服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  // Root HTML is intentionally public. No entitlement check occurs
  // until the first visitor interaction. APIs and private pages retain
  // server-side protection, independent of browser JavaScript or overlays.
  if (url.pathname==='/api/download-access/status' && method==='GET') {
    try {
      return downloadAccessStatusResponse(await resolveDownloadAccess(request,env));
    } catch(error) {
      console.error('Download Starry access status unavailable',error);
      return downloadAccessStatusResponse({status:'unavailable'});
    }
  }
  if (shouldCheckDownloadAccess(url,method)) {
    if (isDownloadPageRequest(url,method) && url.searchParams.get('starry')==='denied')
      return accessDeniedResponse(request,{status:'denied'});
    try {
      const access=await resolveDownloadAccess(request,env);
      if(access.status!=='allowed') return accessDeniedResponse(request,access);
    } catch(error) {
      console.error('Download Starry protected request unavailable',error);
      return accessDeniedResponse(request,{status:'unavailable'});
    }
  }
  const reportManagementRequest =
    (url.pathname === '/report' && ['GET', 'HEAD'].includes(method)) ||
    (url.pathname === '/api/reports' && method === 'GET') ||
    (url.pathname === '/api/report-repair/status' && method === 'POST') ||
    (/^\/api\/reports\/[^/]+\/status$/.test(url.pathname) && method === 'POST');
  if (reportManagementRequest) {
    const allowed = await isSuperAdminRequest(request, env);
    if (!allowed) {
      if (url.pathname === '/report') return Response.redirect(`${url.origin}/`, 302);
      return Response.json({error: '只有超級管理員可以使用此功能'}, {
        status: 403,
        headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
      });
    }
  }

  if (url.pathname === '/api/reports' && method === 'GET') {
    try {
      return await handleAdminReportList(request, env);
    } catch {
      return Response.json({error: '回報管理服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (url.pathname === '/api/favorites') {
    try {
      return await handleFavoritesRequest(request, env);
    } catch {
      return Response.json({error: '收藏服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (url.pathname.startsWith('/api/advanced/')) {
    try {
      const member = await authenticatedDownloadStarryMember(request, env);
      if (!member?.id) {
        return Response.json({error: '進階功能為會員限定，請先登入繁星通行證'}, {status: 401, headers: {'Cache-Control': 'no-store'}});
      }
    } catch {
      return Response.json({error: '會員驗證暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (url.pathname.startsWith('/api/download-history')) {
    try {
      return await handleDownloadHistoryRequest(request, env);
    } catch {
      return Response.json({error: '下載紀錄服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (url.pathname.startsWith('/api/report-repair/')) {
    try {
      return await handleReportRepairRequest(request, env);
    } catch {
      return Response.json({error: '修復通知服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (url.pathname.startsWith('/api/push/')) {
    try {
      return await handlePushRequest(request, env);
    } catch {
      return Response.json({error: '系統通知服務暫時無法使用'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/reports') {
    const membershipRejected = await enforceMemberReport(request, env);
    if (membershipRejected) return membershipRejected;
    const reportRequest = request.clone();
    const response = await handleRequest(request, env);
    if (response.ok) {
      const report = await reportRequest.json().catch(() => ({}));
      const result = await response.clone().json().catch(() => ({}));
      ctx?.waitUntil?.((async () => {
        const push = await notifyReportCreated(env, report).catch(error => ({status: 'failed', error: String(error?.message || error)}));
        await saveReportPushState(env, result?.id, push);
      })());
    }
    return response;
  }

  if (request.method === 'POST' && url.pathname === '/api/download') {
    const historyRequest = request.clone();
    const response = await handleRequest(request, env);
    if (response.ok) {
      const result = await response.clone().json().catch(() => ({}));
      ctx?.waitUntil?.(recordDownloadStart(historyRequest, env, result));
    }
    return response;
  }

  return enhanceProductionPage(await handleRequest(request, env));
}

export default {fetch: fetchHandler};
