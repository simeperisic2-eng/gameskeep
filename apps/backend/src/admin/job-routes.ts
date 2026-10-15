import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { getArticlesQueue } from '../articles/jobs';
import { getCatalogQueue } from '../catalog/jobs';
import { getRatingsQueue } from '../ratings/jobs';
import { getReputationQueue } from '../reputation/jobs';
import { getHomepageQueue } from '../homepage/jobs';
import { getTagsQueue } from '../tags/jobs';
import { getSearchQueue } from '../search/jobs';
import { getListsQueue } from '../lists/jobs';
import { sendError } from './http';

/**
 * One background job's state, by queue + id (Phase P hygiene 3). Every trigger
 * route returns the `jobId` it enqueued, so a caller (staff tooling, the verify
 * suites) waits for ITS run — not "whichever run finished last", which raced
 * boot-time and earlier jobs. Section `jobs` → the ADMIN (40) default; read-only.
 */
const QUEUES: Record<string, () => Queue> = {
  articles: getArticlesQueue as () => Queue,
  catalog: getCatalogQueue as () => Queue,
  ratings: getRatingsQueue as () => Queue,
  reputation: getReputationQueue as () => Queue,
  homepage: getHomepageQueue as () => Queue,
  tags: getTagsQueue as () => Queue,
  search: getSearchQueue as () => Queue,
  lists: getListsQueue as () => Queue,
};

export async function registerJobAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get<{ Params: { queue: string; id: string } }>('/jobs/:queue/:id', async (req, reply) => {
    try {
      const getQueue = QUEUES[req.params.queue];
      if (!getQueue || !/^[A-Za-z0-9:_-]{1,64}$/.test(req.params.id)) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      const job = await getQueue().getJob(req.params.id);
      if (!job) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.send({
        data: {
          queue: req.params.queue,
          id: job.id,
          state: await job.getState(),
          result: job.returnvalue ?? null,
        },
      });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
