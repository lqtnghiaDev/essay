import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';

jest.mock('bcrypt');
import * as bcrypt from 'bcrypt';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  fullName: 'Test User',
  role: 'mentor',
  passwordHash: 'hashed-password',
};

const mockUsersService = {
  findByUsername: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-token'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('returns user without passwordHash when credentials are valid', async () => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser({
        username: 'testuser',
        password: 'correct-password',
      });

      expect(result).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'mentor',
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('returns null when password is incorrect', async () => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser({
        username: 'testuser',
        password: 'wrong-password',
      });

      expect(result).toBeNull();
    });

    it('returns null when user does not exist', async () => {
      mockUsersService.findByUsername.mockResolvedValue(null);

      const result = await service.validateUser({
        username: 'nobody',
        password: 'any',
      });

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('returns access_token, refresh_token and user info', () => {
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const result = service.login(mockUser);

      expect(result).toEqual({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
          role: 'mentor',
        },
      });
      expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
      // refresh token must have expiresIn
      expect(mockJwtService.sign).toHaveBeenLastCalledWith(
        expect.any(Object),
        { expiresIn: '7d' },
      );
    });
  });

  describe('refreshToken', () => {
    it('returns a new access_token', () => {
      mockJwtService.sign.mockReturnValue('new-access-token');

      const result = service.refreshToken(mockUser);

      expect(result).toEqual({ access_token: 'new-access-token' });
      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
    });
  });

  describe('logout', () => {
    it('returns success message', () => {
      const result = service.logout();
      expect(result).toEqual({ message: 'Successfully logged out' });
    });
  });
});
