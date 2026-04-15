import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
  BadRequestException,
  Request,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';

const JWT_SECRET = process.env.JWT_SECRET || 'banking-platform-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const DEMO_USERS: Record<string, { password: string; role: string }> = {
  'admin@bank.com':    { password: 'admin123',    role: 'admin' },
  'customer@bank.com': { password: 'customer123', role: 'customer' },
  'readonly@bank.com': { password: 'readonly123', role: 'readonly' },
};

@Controller('auth')
export class AuthController {

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('email and password are required');
    }

    const user = DEMO_USERS[dto.email];
    const isDemo = !user && dto.password === 'demo';

    if (!user && !isDemo) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user && user.password !== dto.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = {
      sub: `user-${Date.now()}`,
      email: dto.email,
      role: ((user?.role || dto.role || 'customer') as JwtPayload['role']),
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
    const decoded = jwt.decode(token) as JwtPayload;

    return {
      success: true,
      data: {
        token,
        type: 'Bearer',
        expiresAt: new Date(decoded.exp! * 1000).toISOString(),
        user: { id: payload.sub, email: dto.email, role: payload.role },
      },
    };
  }

  @Post('refresh')
  refresh(@Request() req: any) {
    const user: JwtPayload = req.user;
    const newToken = jwt.sign(
      { sub: user.sub, email: user.email, role: user.role, clientId: user.clientId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
    );
    const decoded = jwt.decode(newToken) as JwtPayload;
    return {
      success: true,
      data: {
        token: newToken,
        type: 'Bearer',
        expiresAt: new Date(decoded.exp! * 1000).toISOString(),
      },
    };
  }

  @Get('me')
  me(@Request() req: any) {
    const user: JwtPayload = req.user;
    return {
      success: true,
      data: {
        id: user.sub,
        email: user.email,
        role: user.role,
        clientId: user.clientId,
        tokenExpiresAt: new Date(user.exp! * 1000).toISOString(),
      },
    };
  }
}
