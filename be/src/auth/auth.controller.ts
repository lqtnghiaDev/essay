import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SimpleUserDto } from 'src/users/dto/simple-user.dto';
import { AuthService } from './auth.service';
import { User } from './decorators/user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectPinoLogger(AuthController.name)
    private readonly logger: PinoLogger,
  ) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User login',
    description: 'Logs in a user and returns a JWT token',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      admin: {
        value: {
          username: 'admin1',
          password: '123456',
        },
      },
      mentor: {
        value: {
          username: 'mentor1',
          password: '123456',
        },
      },
      intern: {
        value: {
          username: 'intern1',
          password: '123456',
        },
      },
    },
  })
  async login(@Body() data: LoginDto) {
    const user = await this.authService.validateUser(data);

    if (!user) {
      this.logger.warn({ username: data.username }, 'auth.login.failed');
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.info(
      { user_id: user.id, username: user.username, role: user.role },
      'auth.login.success',
    );
    return this.authService.login(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@User() user: SimpleUserDto) {
    this.logger.info({ user_id: user.id, role: user.role }, 'auth.logout');
    return this.authService.logout();
  }
}
