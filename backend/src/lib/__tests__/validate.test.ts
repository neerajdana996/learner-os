import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { validate } from '../validate.js';
import { TopicCreateSchema } from '../../shared/index.js';

function app() {
  const a = express();
  a.use(express.json());
  a.post('/t', validate(TopicCreateSchema), (req, res) => res.json({ got: req.body }));
  return a;
}

describe('validate()', () => {
  it('passes a valid body through, trimmed', async () => {
    const res = await request(app()).post('/t').send({ title: '  React Hooks ' });
    expect(res.status).toBe(200);
    expect(res.body.got.title).toBe('React Hooks');
  });

  it('rejects an invalid body with 400 and issues', async () => {
    const res = await request(app()).post('/t').send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });
});
