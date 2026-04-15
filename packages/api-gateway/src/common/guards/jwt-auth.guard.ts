import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const JWT_SECRET = process.env.JWT_SECRET || 'banking-platform-secret-key-2024';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'customer' | 'readonly';
  clientId?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Public routes — no auth required
    const PUBLIC_PATHS = ['/health', '/auth/login'];
    if (PUBLIC_PATHS.some(p => request.path === p || request.path.startsWith(p))) return true;

    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required');
    }

    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
      request.user = decoded;

      request.headers['x-user-id'] = decoded.sub;
      request.headers['x-user-role'] = decoded.role;
      request.headers['x-user-email'] = decoded.email;

      return true;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
