/** Connecting the Hammerhead account (OAuth 2.0 authorization code flow). */
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { BadRequestError, ConflictError } from '../errors.ts';
import type { OAuthStates } from '../hammerhead/auth.ts';
import { logger } from '../logger.ts';

const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/** Back to the app (relative, so it works behind the Vite proxy on whatever host the user uses). */
const backToApp = (result: 'connected' | 'denied' | 'error') => `/?hammerhead=${result}`;

export function hammerheadRouter(ctx: AppContext, states: OAuthStates): Router {
  const router = Router();

  const auth = () => {
    if (!ctx.hammerheadAuth)
      throw new BadRequestError(
        'Hammerhead is not configured: set HAMMERHEAD_CLIENT_ID and HAMMERHEAD_CLIENT_SECRET in .env'
      );
    return ctx.hammerheadAuth;
  };

  /** Browser navigation target of the "Connect Hammerhead" button. */
  router.get('/connect', (_req, res) => {
    res.redirect(302, auth().authorizeUrl(states.create()));
  });

  router.get('/callback', async (req, res) => {
    const oauth = auth();
    const q = callbackQuery.safeParse(req.query);
    if (!q.success || !q.data.state || !states.consume(q.data.state)) {
      logger.warn('Hammerhead connect failed: unknown or expired state');
      res.redirect(302, backToApp('error'));
      return;
    }
    if (q.data.error || !q.data.code) {
      logger.info(`Hammerhead connect not completed: ${q.data.error ?? 'no code'}`);
      res.redirect(302, backToApp('denied'));
      return;
    }
    try {
      await oauth.exchangeCode(q.data.code);
      logger.info('Hammerhead account connected');
      res.redirect(302, backToApp('connected'));
    } catch (e) {
      logger.warn(`Hammerhead connect failed: ${(e as Error).message}`);
      res.redirect(302, backToApp('error'));
    }
  });

  router.post('/disconnect', async (_req, res) => {
    const oauth = auth();
    if (ctx.hammerheadSync?.isRunning) throw new ConflictError('A Hammerhead sync is running');
    await oauth.disconnect();
    logger.info('Hammerhead account disconnected');
    res.json({ connected: false });
  });

  return router;
}
